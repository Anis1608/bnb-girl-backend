const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');
const nodemailer = require('nodemailer');

// Load environment config
dotenv.config();

// Load Mongoose models
const User = require('./models/User');
const Option = require('./models/Option');
const Category = require('./models/Category');
const Subcategory = require('./models/Subcategory');
const Episode = require('./models/Episode');
const Resource = require('./models/Resource');
const Mentor = require('./models/Mentor');
const Submission = require('./models/Submission');
const SpecializedField = require('./models/SpecializedField');
const MentorApplication = require('./models/MentorApplication');

// Load Auth Middleware
const auth = require('./middleware/auth');
const userAuth = require('./middleware/userAuth');

const app = express();
// Initialize Stripe safely
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
if (!stripe) {
  console.warn('WARNING: STRIPE_SECRET_KEY is not defined in .env. Stripe integrations will run in fallback/demo mode.');
}

// Initialize Cloudinary safely
const cloudinary = require('cloudinary').v2;
const isCloudinaryConfigured = process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;
if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  console.log('INFO: Cloudinary configured successfully.');
} else {
  console.warn('WARNING: Cloudinary credentials (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) are not defined in .env. Uploads will fallback to local disk storage.');
}

// Helper to send emails using nodemailer/SMTP
const sendEmail = async ({ to, subject, text, html, attachments }) => {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT || '587');

  if (!smtpUser || !smtpPass) {
    console.warn(`WARNING: SMTP_USER and/or SMTP_PASS not defined in .env. Skipping email sending to ${to}. Subject: ${subject}`);
    return { success: false, message: 'SMTP credentials not configured.' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass
      },
      family: 4 // Force IPv4 to resolve ENETUNREACH on IPv6 in environments like Render
    });

    const info = await transporter.sendMail({
      from: `"Bold & Brilliant Girls" <${smtpUser}>`,
      to,
      subject,
      text,
      html,
      attachments
    });

    console.log(`[SMTP Email Sent] Message ID: ${info.messageId} to ${to}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[SMTP Email Error] Failed to send email to ${to}:`, err);
    return { success: false, error: err.message };
  }
};

// Generate a random Google Meet link
function generateMeetLink() {
  const part1 = Math.random().toString(36).slice(2, 5);
  const part2 = Math.random().toString(36).slice(2, 6);
  const part3 = Math.random().toString(36).slice(2, 5);
  return `https://meet.google.com/${part1}-${part2}-${part3}`;
}

// Generate standard .ics calendar invite string
function generateIcsFile({ start, end, summary, description, location }) {
  const formatIcsDate = (date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };

  const dtStart = formatIcsDate(start);
  const dtEnd = formatIcsDate(end);
  const dtStamp = formatIcsDate(new Date());

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bold and Brilliant Girls//Mentorship Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${Math.random().toString(36).slice(2)}@bnbgirl.com`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
    `LOCATION:${location}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

const PORT = process.env.PORT || 5002;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bbg-platform';

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Middlewares
app.use(morgan('dev'));
app.use(cors());
app.use(express.json());
// Serve uploads folder as static files
app.use('/uploads', express.static(uploadsDir));

// Mount Mentor Router
app.use('/api/mentor', require('./routes/mentor'));

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

/* ====================================================================
   PUBLIC API ENDPOINTS
   ==================================================================== */

// Health Check Endpoint (for self-pings and keep-awake)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// 1. GET /api/stats - Site numbers
app.get('/api/stats', async (req, res) => {
  try {
    const keys = ['episodes', 'mentors', 'community', 'downloads', 'countries', 'response', 'industries', 'views', 'views_unit'];
    const dbOptions = await Option.find({ key: { $in: keys.map(k => `bbg_stat_${k}`) } });

    const stats = {};
    // Load defaults first
    stats['views_unit'] = 'M+';
    keys.forEach(k => {
      if (k !== 'views_unit') stats[k] = '0';
    });

    // Merge DB options
    dbOptions.forEach(opt => {
      const keyName = opt.key.replace('bbg_stat_', '');
      stats[keyName] = opt.value;
    });

    // Provide dynamic fallback counters if options are not set
    if (stats['episodes'] === '0' || !stats['episodes']) {
      stats['episodes'] = String(await Episode.countDocuments({ status: 'published' }));
    }
    if (stats['mentors'] === '0' || !stats['mentors']) {
      const epMentorsCount = await Episode.countDocuments({ is_mentor: true, status: 'published' });
      const dedicatedCount = await Mentor.countDocuments({ status: 'published' });
      stats['mentors'] = String(epMentorsCount + dedicatedCount);
    }
    if (stats['community'] === '0' || !stats['community']) {
      stats['community'] = String(await Submission.countDocuments({ form_type: 'community' }));
    }

    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching stats' });
  }
});

// 2. GET /api/categories - Categories list
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await Category.find().sort({ sort_order: 1, name: 1 }).lean();

    // Attach sub_count dynamically
    for (const cat of categories) {
      cat.sub_count = await Subcategory.countDocuments({ category_id: cat._id });
    }

    res.json(categories);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching categories' });
  }
});

// 3. GET /api/categories/:id/subcategories - Subcategories for a category
app.get('/api/categories/:id/subcategories', async (req, res) => {
  try {
    const catId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(catId)) {
      return res.status(400).json({ message: 'Invalid category ID' });
    }
    const subcategories = await Subcategory.find({ category_id: catId }).sort({ sort_order: 1, name: 1 });
    res.json(subcategories);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching subcategories' });
  }
});

// 3.5 GET /api/subcategories/:id/specialized-fields - Level 3 fields for a subcategory
app.get('/api/subcategories/:id/specialized-fields', async (req, res) => {
  try {
    const subId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(subId)) {
      return res.status(400).json({ message: 'Invalid subcategory ID' });
    }
    const fields = await SpecializedField.find({ subcategory_id: subId }).sort({ sort_order: 1, name: 1 });
    res.json(fields);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching specialized fields' });
  }
});

// 4. GET /api/episodes - Paginated and filtered episodes
app.get('/api/episodes', async (req, res) => {
  try {
    const perPage = parseInt(req.query.per_page) || 50;
    const page = parseInt(req.query.page) || 1;
    const catId = req.query.category;
    const search = req.query.search;
    const isMentor = req.query.is_mentor;

    const query = { status: 'published' };

    if (catId && mongoose.Types.ObjectId.isValid(catId)) {
      query.category_id = catId;
    }

    if (isMentor !== undefined && isMentor !== null) {
      query.is_mentor = isMentor === '1' || isMentor === 'true';
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { guest_name: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await Episode.countDocuments(query);
    const episodes = await Episode.find(query)
      .sort({ created_at: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .populate('category_id')
      .populate('subcategory_id')
      .populate('specialized_field_id')
      .lean();

    // Re-map fields to match WordPress rest response structure
    const rows = episodes.map(ep => ({
      id: ep._id,
      title: ep.title,
      guest_name: ep.guest_name,
      guest_role: ep.guest_role,
      guest_photo: ep.guest_photo,
      guest_bio: ep.guest_bio,
      guest_quote: ep.guest_quote,
      episode_number: ep.episode_number,
      category_id: ep.category_id ? ep.category_id._id : null,
      category_name: ep.category_id ? ep.category_id.name : '',
      category_icon: ep.category_id ? ep.category_id.icon : '',
      category_color: ep.category_id ? ep.category_id.color : '',
      category_slug: ep.category_id ? ep.category_id.slug : '',
      subcategory_id: ep.subcategory_id ? ep.subcategory_id._id : null,
      subcategory_name: ep.subcategory_id ? ep.subcategory_id.name : '',
      specialized_field_id: ep.specialized_field_id ? ep.specialized_field_id._id : null,
      specialized_field_name: ep.specialized_field_id ? ep.specialized_field_id.name : '',
      episode_type: ep.episode_type || 'Interview',
      youtube_id: ep.youtube_id,
      spotify_url: ep.spotify_url,
      audio_url: ep.audio_url,
      pdf_url: ep.pdf_url,
      duration: ep.duration,
      description: ep.description,
      tags: ep.tags,
      is_featured: ep.is_featured ? 1 : 0,
      is_new: ep.is_new ? 1 : 0,
      is_mentor: ep.is_mentor ? 1 : 0,
      mentor_rate: ep.mentor_rate,
      mentor_avail: ep.mentor_avail,
      mentor_linkedin: ep.mentor_linkedin,
      mentor_fields: ep.mentor_fields,
      status: ep.status,
      created_at: ep.created_at
    }));

    res.json({ rows, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching episodes' });
  }
});

// 5. GET /api/episodes/:id - Single episode
app.get('/api/episodes/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: 'Episode not found' });
    }

    const ep = await Episode.findById(id)
      .populate('category_id')
      .populate('subcategory_id')
      .populate('specialized_field_id');

    if (!ep) {
      return res.status(404).json({ message: 'Episode not found' });
    }

    // Map fields
    const formatted = {
      id: ep._id,
      title: ep.title,
      guest_name: ep.guest_name,
      guest_role: ep.guest_role,
      guest_photo: ep.guest_photo,
      guest_bio: ep.guest_bio,
      guest_quote: ep.guest_quote,
      episode_number: ep.episode_number,
      category_id: ep.category_id ? ep.category_id._id : null,
      category_name: ep.category_id ? ep.category_id.name : '',
      category_icon: ep.category_id ? ep.category_id.icon : '',
      category_slug: ep.category_id ? ep.category_id.slug : '',
      subcategory_id: ep.subcategory_id ? ep.subcategory_id._id : null,
      subcategory_name: ep.subcategory_id ? ep.subcategory_id.name : '',
      specialized_field_id: ep.specialized_field_id ? ep.specialized_field_id._id : null,
      specialized_field_name: ep.specialized_field_id ? ep.specialized_field_id.name : '',
      episode_type: ep.episode_type || 'Interview',
      youtube_id: ep.youtube_id,
      spotify_url: ep.spotify_url,
      audio_url: ep.audio_url,
      pdf_url: ep.pdf_url,
      duration: ep.duration,
      description: ep.description,
      tags: ep.tags,
      is_featured: ep.is_featured ? 1 : 0,
      is_new: ep.is_new ? 1 : 0,
      is_mentor: ep.is_mentor ? 1 : 0,
      mentor_rate: ep.mentor_rate,
      mentor_avail: ep.mentor_avail,
      mentor_linkedin: ep.mentor_linkedin,
      mentor_fields: ep.mentor_fields,
      status: ep.status,
      created_at: ep.created_at
    };

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// 6. GET /api/mentors - Consolidated mentors list
app.get('/api/mentors', async (req, res) => {
  try {
    const calculateRates = (baseRate) => {
      let numericBase = 20;
      if (baseRate) {
        const match = String(baseRate).replace(/[^0-9]/g, '');
        if (match) {
          numericBase = parseInt(match, 10);
        }
      }
      const isFree = !baseRate || baseRate.toLowerCase().includes('free') || numericBase === 0;
      if (isFree) {
        return { p30: 'Free', p60: 'Free', p120: 'Free' };
      }
      return {
        p30: `$${numericBase}`,
        p60: `$${Math.round(numericBase * 1.8)}`,
        p120: `$${Math.round(numericBase * 3.2)}`
      };
    };

    // 1. Episode guests who are mentors
    const epMentors = await Episode.find({ is_mentor: true, status: 'published' })
      .populate('category_id')
      .sort({ is_featured: -1, created_at: -1 })
      .lean();

    const formattedEp = epMentors.map(e => {
      const rates = calculateRates(e.mentor_rate);
      return {
        id: e._id,
        name: e.guest_name,
        role: e.guest_role,
        photo: e.guest_photo,
        bio: e.guest_bio,
        quote: e.guest_quote,
        rate: e.mentor_rate,
        availability: e.mentor_avail,
        linkedin: e.mentor_linkedin,
        expertise_areas: e.mentor_fields,
        youtube_id: e.youtube_id,
        episode_number: e.episode_number,
        episode_title: e.title,
        cat_name: e.category_id ? e.category_id.name : '',
        cat_icon: e.category_id ? e.category_id.icon : '',
        source: 'episode',
        durs: (e.durs && e.durs.length > 0) ? e.durs : ['30', '60'],
        slots: (e.slots && e.slots.length > 0) ? e.slots : ["09:00", "09:30", "10:00", "11:00", "11:30", "14:00", "14:30", "15:00", "16:00", "16:30"],
        busy: e.busy || ["11:00", "15:00"],
        p30: rates.p30,
        p60: rates.p60,
        p120: rates.p120,
        pricing: e.pricing || {}
      };
    });

    // 2. Dedicated mentors
    const dedicated = await Mentor.find({ status: 'published' })
      .populate('category_id')
      .populate('episode_id')
      .sort({ is_featured: -1, created_at: -1 })
      .lean();

    const formattedDedicated = dedicated.map(m => {
      const rates = calculateRates(m.rate);
      return {
        id: m._id,
        name: m.name,
        role: m.role,
        photo: m.photo,
        bio: m.bio,
        quote: m.quote,
        rate: m.rate,
        availability: m.availability,
        linkedin: m.linkedin,
        expertise_areas: m.expertise_areas,
        youtube_id: m.episode_id ? m.episode_id.youtube_id : '',
        episode_number: m.episode_id ? m.episode_id.episode_number : '',
        episode_title: m.episode_id ? m.episode_id.title : '',
        cat_name: m.category_id ? m.category_id.name : '',
        cat_icon: m.category_id ? m.category_id.icon : '',
        source: 'dedicated',
        episode_id: m.episode_id ? m.episode_id._id : null,
        durs: (m.durs && m.durs.length > 0) ? m.durs : ['30', '60'],
        slots: (m.slots && m.slots.length > 0) ? m.slots : ["09:00", "09:30", "10:00", "11:00", "11:30", "14:00", "14:30", "15:00", "16:00", "16:30"],
        busy: m.busy || ["11:00", "15:00"],
        p30: rates.p30,
        p60: rates.p60,
        p120: rates.p120,
        pricing: m.pricing || {}
      };
    });

    // Combine lists
    res.json([...formattedEp, ...formattedDedicated]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching mentors' });
  }
});

// 6.5 GET /api/mentors/:id/availability - Dynamic timeslot availability on a selected date
app.get('/api/mentors/:id/availability', async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query; // YYYY-MM-DD format

    if (!date) {
      return res.status(400).json({ success: false, message: 'Date parameter is required (YYYY-MM-DD)' });
    }

    // 1. Find all paid/reviewed bookings for this mentor on the selected date (excluding spam status)
    const bookings = await Submission.find({
      form_type: 'mentorship',
      status: { $ne: 'spam' },
      $or: [
        { 'data.mentor_id': id },
        { 'data.mentor_id': String(id) }
      ],
      'data.date': date
    });

    const toMinutes = (timeStr) => {
      const [h, m] = timeStr.split(':').map(Number);
      return h * 60 + m;
    };

    // Calculate all blocked minute ranges
    const blockedRanges = bookings.map(b => {
      const startMins = toMinutes(b.data.time);
      const duration = parseInt(b.data.duration) || 30;
      return { start: startMins, end: startMins + duration };
    });

    // Standard default slots for the mentor (or default ones if not customized)
    let slots = ["09:00", "09:30", "10:00", "11:00", "11:30", "14:00", "14:30", "15:00", "16:00", "16:30"];
    let busySlots = ["11:00", "15:00"];

    if (mongoose.Types.ObjectId.isValid(id)) {
      const mentor = await Mentor.findById(id);
      if (mentor) {
        if (mentor.slots && mentor.slots.length > 0) slots = mentor.slots;
        if (mentor.busy) busySlots = mentor.busy;
      } else {
        const ep = await Episode.findById(id);
        if (ep) {
          if (ep.slots && ep.slots.length > 0) slots = ep.slots;
          if (ep.busy) busySlots = ep.busy;
        }
      }
    }

    // Identify which slots from the mentor's potential slots list overlap with booked ranges
    const bookedSlots = slots.filter(slot => {
      const slotMins = toMinutes(slot);
      return blockedRanges.some(range => slotMins >= range.start && slotMins < range.end);
    });

    // Combine statically busy slots + dynamically booked slots
    const allBlockedSlots = Array.from(new Set([...busySlots, ...bookedSlots]));

    res.json({
      success: true,
      bookedSlots: allBlockedSlots,
      onlyBooked: bookedSlots,
      onlyStatic: busySlots
    });
  } catch (err) {
    console.error('Error calculating mentor availability:', err);
    res.status(500).json({ success: false, message: 'Internal server error calculating availability', error: err.message });
  }
});

// 7. GET /api/resources - Resources list with filters
app.get('/api/resources', async (req, res) => {
  try {
    const perPage = parseInt(req.query.per_page) || 100;
    const page = parseInt(req.query.page) || 1;
    const catId = req.query.category;
    const type = req.query.type;
    const search = req.query.search;

    const query = { status: 'published' };

    if (catId && mongoose.Types.ObjectId.isValid(catId)) {
      query.category_id = catId;
    }

    if (type) {
      query.resource_type = type;
    }

    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }

    const total = await Resource.countDocuments(query);
    const resources = await Resource.find(query)
      .sort({ sort_order: 1, is_featured: -1, created_at: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .populate('category_id')
      .populate('subcategory_id')
      .populate('specialized_field_id')
      .lean();

    const rows = resources.map(r => ({
      id: r._id,
      title: r.title,
      description: r.description,
      resource_type: r.resource_type,
      category_id: r.category_id ? r.category_id._id : null,
      cat_name: r.category_id ? r.category_id.name : '',
      cat_icon: r.category_id ? r.category_id.icon : '',
      subcategory_id: r.subcategory_id ? r.subcategory_id._id : null,
      subcategory_name: r.subcategory_id ? r.subcategory_id.name : '',
      specialized_field_id: r.specialized_field_id ? r.specialized_field_id._id : null,
      specialized_field_name: r.specialized_field_id ? r.specialized_field_id.name : '',
      episode_ref: r.episode_ref,
      file_url: r.file_url,
      external_link: r.external_link,
      pages: r.pages,
      icon: r.icon,
      cover_color: r.cover_color,
      is_featured: r.is_featured ? 1 : 0,
      is_coming_soon: r.is_coming_soon ? 1 : 0,
      sort_order: r.sort_order,
      status: r.status,
      created_at: r.created_at
    }));

    res.json({ rows, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching resources' });
  }
});

// Recursive sanitizer to strip HTML/Script tags and prevent XSS injection
const sanitizeInput = (val) => {
  if (typeof val === 'string') {
    return val.replace(/<[^>]*>/g, '');
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeInput);
  }
  if (val && typeof val === 'object') {
    const cleaned = {};
    for (const key in val) {
      cleaned[key] = sanitizeInput(val[key]);
    }
    return cleaned;
  }
  return val;
};

// 8. POST /api/forms - Submission receiver mapping
const submitForm = async (formType, req, res) => {
  try {
    const data = sanitizeInput(req.body || {});
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Basic Validation depending on form type
    if (formType === 'ask_guest' && !data.question) {
      return res.status(400).json({ success: false, message: 'Question is required' });
    }
    if (formType === 'suggest_guest' && !data.suggestion) {
      return res.status(400).json({ success: false, message: 'Suggestion is required' });
    }
    if (['community', 'quiz', 'mentorship', 'guest_apply', 'mentor_apply'].includes(formType) && !data.email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const submission = new Submission({
      form_type: formType,
      data,
      ip_address: ip
    });
    await submission.save();

    // Send notifications if setting is enabled (in real production this would use nodemailer)
    const emailOpt = await Option.findOne({ key: 'bbg_email_on_submit' });
    const notifyEmail = await Option.findOne({ key: 'bbg_email' });
    const adminEmailAddress = notifyEmail?.value || 'sanah@bnbgirl.com';

    if (emailOpt?.value === '1' && adminEmailAddress) {
      console.log(`[Email Notification Sent to ${adminEmailAddress}] New submission for ${formType}`);
    }

    // Special Email Handlers for Newsletter Subscription ('community')
    if (formType === 'community' && data.email) {
      const origin = req.headers.origin || 'https://bnbgirl.com';
      const unsubscribeLink = `${origin}/unsubscribe?email=${encodeURIComponent(data.email)}`;

      // 1. Welcome email to subscriber
      const subscriberHtml = `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 30px; color: #1f2937; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 16px; background-color: #ffffff; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05);">
          <div style="text-align: center; margin-bottom: 25px;">
            <h1 style="color: #db2777; font-size: 28px; font-weight: 800; margin: 0; letter-spacing: -0.025em;">Bold &amp; Brilliant Girls</h1>
            <p style="color: #6b7280; font-size: 14px; margin-top: 5px;">Empowering the next generation of female leaders</p>
          </div>
          <hr style="border: 0; border-top: 1px solid #f3f4f6; margin-bottom: 25px;" />
          <h2 style="color: #111827; font-size: 20px; font-weight: 700; margin-top: 0;">Welcome to the Community! ✨</h2>
          <p style="font-size: 16px; line-height: 1.6; color: #4b5563;">Thank you for subscribing to Bold &amp; Brilliant Girls. You are now officially part of our global network of ambitious young women, creators, and mentors!</p>
          <div style="background: linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%); border-left: 4px solid #db2777; padding: 20px; margin: 25px 0; border-radius: 8px;">
            <h3 style="margin: 0 0 10px 0; font-size: 16px; font-weight: 700; color: #9d174d;">What's next?</h3>
            <ul style="margin: 0; padding-left: 20px; color: #9d174d; font-size: 14px; line-height: 1.6;">
              <li>Get the weekly <strong>Tip of the Week</strong> email newsletter.</li>
              <li>Gain access to exclusive premium templates, guide sheets, and career resources.</li>
              <li>Connect with world-class industry mentors through our dashboard.</li>
            </ul>
          </div>
          <p style="font-size: 15px; line-height: 1.6; color: #4b5563;">We're thrilled to have you with us on this journey. Stay tuned for our upcoming resources and masterclasses.</p>
          <p style="font-size: 14px; line-height: 1.6; color: #6b7280; text-align: center; margin-top: 20px;">
            If you ever wish to opt out, you can <a href="${unsubscribeLink}" style="color: #db2777; text-decoration: underline; font-weight: bold;">unsubscribe here</a> at any time.
          </p>
          <div style="text-align: center; margin-top: 30px;">
            <a href="https://bnbgirl.com/dashboard" style="display: inline-block; background-color: #db2777; color: #ffffff; padding: 12px 24px; font-weight: bold; border-radius: 9999px; text-decoration: none; font-size: 15px; box-shadow: 0 4px 6px -1px rgba(219, 39, 119, 0.2);">Explore Your Dashboard</a>
          </div>
          <hr style="border: 0; border-top: 1px solid #f3f4f6; margin-top: 35px; margin-bottom: 15px;" />
          <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0;">You received this because you subscribed on our website. You can <a href="${unsubscribeLink}" style="color: #db2777; text-decoration: underline;">unsubscribe</a> at any time.</p>
          <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 5px 0 0 0;">&copy; 2026 Bold &amp; Brilliant Girls. All rights reserved.</p>
        </div>
      `;

      await sendEmail({
        to: data.email,
        subject: 'Welcome to the Bold & Brilliant Girls Community! ✨',
        text: `Welcome to Bold & Brilliant Girls!\n\nThank you for subscribing to our newsletter. You are now part of our community of leaders.\n\nExplore your dashboard: https://bnbgirl.com/dashboard\n\nUnsubscribe: ${unsubscribeLink}`,
        html: subscriberHtml
      });

      // 2. Notification email to admin
      const adminHtml = `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 30px; color: #1f2937; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 16px; background-color: #ffffff; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05);">
          <div style="text-align: center; margin-bottom: 25px;">
            <h2 style="color: #6366f1; font-size: 22px; font-weight: 800; margin: 0;">New Newsletter Subscriber! 🎉</h2>
            <p style="color: #6b7280; font-size: 14px; margin-top: 5px;">Bold &amp; Brilliant Girls Admin Notification</p>
          </div>
          <hr style="border: 0; border-top: 1px solid #f3f4f6; margin-bottom: 25px;" />
          <div style="background-color: #f5f3ff; border-left: 4px solid #6366f1; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <p style="margin: 0; font-size: 15px; color: #4338ca;"><strong>Subscriber Email:</strong> <span style="text-decoration: underline;">${data.email}</span></p>
            <p style="margin: 5px 0 0 0; font-size: 14px; color: #6366f1;"><strong>IP Address:</strong> ${ip || 'Unknown'}</p>
            <p style="margin: 5px 0 0 0; font-size: 14px; color: #6366f1;"><strong>Date/Time:</strong> ${new Date().toLocaleString()}</p>
          </div>
          <p style="font-size: 15px; line-height: 1.6; color: #4b5563;">This user signed up for the newsletter on the website. Their record has been saved in the Submissions database as a <code>community</code> submission.</p>
          <div style="text-align: center; margin-top: 25px;">
            <a href="https://bnbgirl.com/admin" style="display: inline-block; background-color: #6366f1; color: #ffffff; padding: 10px 20px; font-weight: bold; border-radius: 8px; text-decoration: none; font-size: 14px;">View in Admin Portal</a>
          </div>
          <hr style="border: 0; border-top: 1px solid #f3f4f6; margin-top: 30px; margin-bottom: 15px;" />
          <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0;">&copy; 2026 Bold &amp; Brilliant Girls. Admin System.</p>
        </div>
      `;

      await sendEmail({
        to: adminEmailAddress,
        subject: `New Newsletter Subscriber Joined: ${data.email} 🎉`,
        text: `New subscriber email: ${data.email}\nIP: ${ip}\nDate: ${new Date().toLocaleString()}`,
        html: adminHtml
      });
    }

    res.json({ success: true, message: 'Received!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error recording submission' });
  }
};

// Mount form routes to match public endpoints
app.post('/api/ask-guest', (req, res) => submitForm('ask_guest', req, res));
app.post('/api/suggest-guest', (req, res) => submitForm('suggest_guest', req, res));
app.post('/api/community', (req, res) => submitForm('community', req, res));
app.post('/api/quiz', (req, res) => submitForm('quiz', req, res));
app.post('/api/mentorship', (req, res) => submitForm('mentorship', req, res));
app.post('/api/guest-apply', (req, res) => submitForm('guest_apply', req, res));
app.post('/api/mentor-apply', (req, res) => submitForm('mentor_apply', req, res));

// Public endpoint for unsubscribing from newsletter/community submissions (CAN-SPAM compliance)
app.post('/api/unsubscribe', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const result = await Submission.updateMany(
      { "data.email": email },
      { $set: { "data.unsubscribed": true, "status": "unsubscribed" } }
    );

    console.log(`[Unsubscribe Success] Email: ${email}. Matches updated: ${result.modifiedCount}`);
    res.json({ success: true, message: 'Unsubscribed successfully.' });
  } catch (err) {
    console.error('[Unsubscribe Error]', err);
    res.status(500).json({ success: false, message: 'Internal server error processing unsubscribe.' });
  }
});

// Public endpoint for submitting a mentor application with optional photo upload
app.post('/api/mentor-application', upload.single('photo'), async (req, res) => {
  try {
    const { name, email, role, organisation, linkedin, expertise, bio, motivation, years_exp } = req.body;

    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Name and Email are required' });
    }

    let photoUrl = '';
    if (req.file) {
      if (isCloudinaryConfigured) {
        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(req.file.path, {
          resource_type: 'auto',
          folder: 'bbg_mentors'
        });
        fs.unlinkSync(req.file.path);
        photoUrl = result.secure_url;
      } else {
        // Local storage fallback
        photoUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
      }
    }

    const application = new MentorApplication({
      name,
      email,
      role: role || '',
      organisation: organisation || '',
      linkedin: linkedin || '',
      expertise: expertise || '',
      bio: bio || '',
      motivation: motivation || '',
      years_exp: years_exp || '',
      photo: photoUrl,
      status: 'pending'
    });

    await application.save();

    // Send email notification to admin & applicant (non-blocking)
    const adminEmail = process.env.ADMIN_EMAIL || 'sanah@bnbgirl.com';

    // Notification to admin
    sendEmail({
      to: adminEmail,
      subject: `New Mentor Application: ${name}`,
      text: `Hello,\n\nYou have received a new mentor application from ${name} (${email}).\nRole: ${role}\nOrganisation: ${organisation}\nLinkedIn: ${linkedin}\n\nReview it in the admin panel.`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #6C5DD3;">New Mentor Application</h2>
          <p>You have received a new mentor application.</p>
          <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; width: 150px;">Name</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${name}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Email</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${email}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Role/Job Title</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${role || 'N/A'}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Organisation</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${organisation || 'N/A'}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">LinkedIn</td><td style="padding: 8px; border-bottom: 1px solid #eee;"><a href="${linkedin}">${linkedin}</a></td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Years Exp</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${years_exp || 'N/A'}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Expertise</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${expertise || 'N/A'}</td></tr>
          </table>
          <p style="margin-top: 20px;"><a href="https://bnbgirl.com/admin" style="background-color: #6C5DD3; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Go to Admin Panel</a></p>
        </div>
      `
    });

    // Confirmation to applicant
    sendEmail({
      to: email,
      subject: `Your Mentor Application - Bold & Brilliant Girls`,
      text: `Hello ${name},\n\nThank you for applying to become a mentor on Bold & Brilliant Girls!\n\nWe have received your application and our team will review it. We will notify you once a decision has been made.\n\nBest regards,\nBold & Brilliant Girls Team`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
          <h2 style="color: #6C5DD3; text-align: center;">Thank You, ${name}!</h2>
          <p>Thank you for applying to become a mentor on the <strong>Bold & Brilliant Girls</strong> platform!</p>
          <p>We are thrilled that you want to share your expertise and help empower the next generation of girls in tech and leadership.</p>
          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <strong style="color: #555;">Next Steps:</strong>
            <ul style="padding-left: 20px; margin-top: 10px; line-height: 1.5;">
              <li>Our team will review your application details.</li>
              <li>We will verify your LinkedIn profile and professional experience.</li>
              <li>You will receive an email from us with our decision and next steps within 3-5 business days.</li>
            </ul>
          </div>
          <p>If you have any questions in the meantime, feel free to reply directly to this email.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #999; text-align: center;">&copy; ${new Date().getFullYear()} Bold & Brilliant Girls. All rights reserved.</p>
        </div>
      `
    });

    res.json({ success: true, message: 'Application submitted successfully!', data: application });
  } catch (err) {
    console.error('Mentor application error:', err);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

// 8.5 POST /api/create-checkout-session - Stripe Checkout Session creation (Secure Rates lookup)
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { mentorId, mentor, dur, date, time, email } = req.body;

    let baseRate = '$20';
    let found = false;

    let dbMentor = null;
    let dbEp = null;

    // 1. Try finding by ID in Mentor collection
    if (mentorId && mongoose.Types.ObjectId.isValid(mentorId)) {
      dbMentor = await Mentor.findById(mentorId);
      if (dbMentor) {
        baseRate = dbMentor.rate || '$20';
        found = true;
      }
    }

    // 2. Try finding by ID in Episode collection (some guest mentors are episodes)
    if (!found && mentorId && mongoose.Types.ObjectId.isValid(mentorId)) {
      dbEp = await Episode.findById(mentorId);
      if (dbEp) {
        baseRate = dbEp.mentor_rate || '$20';
        found = true;
      }
    }

    // 3. Fallback to name search in Mentor
    if (!found && mentor) {
      dbMentor = await Mentor.findOne({ name: mentor });
      if (dbMentor) {
        baseRate = dbMentor.rate || '$20';
        found = true;
      }
    }

    // 4. Fallback to name search in Episode
    if (!found && mentor) {
      dbEp = await Episode.findOne({ guest_name: mentor, is_mentor: true });
      if (dbEp) {
        baseRate = dbEp.mentor_rate || '$20';
        found = true;
      }
    }

    let customPriceStr = null;
    if (dbMentor && dbMentor.pricing) {
      customPriceStr = typeof dbMentor.pricing.get === 'function' ? dbMentor.pricing.get(dur) : dbMentor.pricing[dur];
    } else if (dbEp && dbEp.pricing) {
      customPriceStr = typeof dbEp.pricing.get === 'function' ? dbEp.pricing.get(dur) : dbEp.pricing[dur];
    }

    let finalAmount;
    if (customPriceStr) {
      const match = String(customPriceStr).replace(/[^0-9]/g, '');
      finalAmount = match ? parseInt(match, 10) : 20;
    } else {
      // Parse numeric base rate
      let numericBase = 20;
      if (baseRate) {
        const match = String(baseRate).replace(/[^0-9]/g, '');
        if (match) {
          numericBase = parseInt(match, 10);
        }
      }

      // Calculate dynamic rate based on duration
      finalAmount = numericBase;
      if (dur === '60') {
        finalAmount = Math.round(numericBase * 1.8);
      } else if (dur === '120') {
        finalAmount = Math.round(numericBase * 3.2);
      }
    }

    // Convert to cents
    const amountInCents = finalAmount * 100;

    // If session is Free ($0), return custom mock/free session indicator
    if (amountInCents === 0 || baseRate.toLowerCase().includes('free')) {
      return res.json({ id: 'free_session', url: null });
    }

    // Check if Stripe is initialized or if it's the placeholder key
    if (!stripe || process.env.STRIPE_SECRET_KEY === 'sk_test_placeholder_key_here' || !process.env.STRIPE_SECRET_KEY) {
      console.warn('Running in Demo/Mock Mode. Stripe not fully configured.');
      // Return a mock checkout URL pointing directly to success page
      const mockSuccessUrl = `${req.headers.origin || 'http://localhost:5173'}/mentorship?session_id=mock_checkout_session_id`;
      return res.json({ id: 'mock_session', url: mockSuccessUrl });
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Mentorship with ${mentor}`,
              description: `${dur} minutes session on ${date} at ${time}`,
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${req.headers.origin || 'http://localhost:5173'}/mentorship?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'http://localhost:5173'}/mentorship?cancelled=true`,
      metadata: {
        mentorId: String(mentorId || ''),
        mentor: String(mentor || ''),
        dur: String(dur || ''),
        date: String(date || ''),
        time: String(time || ''),
        email: String(email || '')
      },
    });

    res.json({ id: session.id, url: session.url });
  } catch (err) {
    console.error('Error creating checkout session:', err);
    res.status(500).json({ message: 'Internal server error creating checkout session', error: err.message });
  }
});

// 8.6 GET /api/verify-checkout-session/:sessionId - Stripe Checkout Session Verification
app.get('/api/verify-checkout-session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required' });
    }

    let bookingData = null;

    // Check if it's mock session
    if (sessionId === 'mock_checkout_session_id') {
      bookingData = {
        mentor: 'Demo Mentor',
        mentor_id: 'priya',
        duration: '30',
        date: new Date().toISOString().slice(0, 10),
        time: '10:00',
        email: 'demo@example.com',
        amount: '$20',
        submitted_at: new Date().toISOString()
      };
    } else {
      // Check if Stripe is initialized
      if (!stripe || process.env.STRIPE_SECRET_KEY === 'sk_test_placeholder_key_here' || !process.env.STRIPE_SECRET_KEY) {
        return res.status(400).json({ success: false, message: 'Stripe not configured to retrieve session' });
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (!session) {
        return res.status(404).json({ success: false, message: 'Checkout session not found on Stripe' });
      }

      if (session.payment_status !== 'paid') {
        return res.status(400).json({ success: false, message: 'Checkout session not paid' });
      }

      const meta = session.metadata || {};
      bookingData = {
        mentor: meta.mentor,
        mentor_id: meta.mentorId,
        duration: meta.dur,
        date: meta.date,
        time: meta.time,
        email: meta.email,
        amount: `$${(session.amount_total / 100).toFixed(0)}`,
        stripe_session_id: sessionId,
        submitted_at: new Date().toISOString()
      };
    }

    // Save booking in the Submission collection if it doesn't already exist (deduplication check by stripe_session_id)
    let submission = null;
    if (sessionId !== 'mock_checkout_session_id') {
      submission = await Submission.findOne({ 'data.stripe_session_id': sessionId });
    }

    if (!submission) {
      // 1. Generate Google Meet link
      const meetLink = generateMeetLink();
      bookingData.meet_link = meetLink;

      submission = new Submission({
        form_type: 'mentorship',
        data: bookingData,
        ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress
      });
      await submission.save();
      console.log('Mentorship booking recorded from checkout session payment:', sessionId);

      // 2. Fetch Mentor Email if possible
      let mentorEmail = '';
      if (bookingData.mentor_id && mongoose.Types.ObjectId.isValid(bookingData.mentor_id)) {
        const dbMentor = await Mentor.findById(bookingData.mentor_id);
        if (dbMentor && dbMentor.email) {
          mentorEmail = dbMentor.email;
        }
      }

      // 3. Create ICS invitation
      const dateParts = bookingData.date.split('-');
      const timeParts = bookingData.time.split(':');
      const startTime = new Date(
        parseInt(dateParts[0]),
        parseInt(dateParts[1]) - 1,
        parseInt(dateParts[2]),
        parseInt(timeParts[0]),
        parseInt(timeParts[1]),
        0
      );
      const durationMinutes = parseInt(bookingData.duration) || 30;
      const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

      const icsContent = generateIcsFile({
        start: startTime,
        end: endTime,
        summary: `Mentorship Session: ${bookingData.mentor} & Student`,
        description: `Your interactive mentorship session of ${bookingData.duration} minutes has been scheduled.\nGoogle Meet Link: ${meetLink}`,
        location: meetLink
      });

      const inviteAttachment = {
        filename: 'invite.ics',
        content: icsContent,
        contentType: 'text/calendar; charset=utf-8; method=REQUEST'
      };

      // 4. Send email to Student
      const studentHtml = `
        <div style="font-family: sans-serif; padding: 25px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
          <h2 style="color: #EC4899; text-align: center;">Your Mentorship Session is Confirmed!</h2>
          <p>Hi there,</p>
          <p>Thank you for booking a session. Your payment was successful, and your mentorship meeting has been scheduled automatically.</p>
          
          <div style="background-color: #fdf2f8; border-left: 4px solid #EC4899; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
            <p style="margin: 0; font-weight: bold; color: #9d174d;">Meeting Details:</p>
            <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #9d174d; line-height: 1.6;">
              <li><strong>Mentor:</strong> ${bookingData.mentor}</li>
              <li><strong>Date:</strong> ${bookingData.date}</li>
              <li><strong>Time:</strong> ${bookingData.time}</li>
              <li><strong>Duration:</strong> ${bookingData.duration} minutes</li>
              <li><strong>Google Meet Link:</strong> <a href="${meetLink}" style="color: #be185d; font-weight: bold;">Join Google Meet</a></li>
            </ul>
          </div>
          <p>We've attached a calendar invite (<code>invite.ics</code>) to this email. You can open it to add this event directly to your calendar.</p>
          <p>Enjoy your session!</p>
          <hr style="border: 0; border-top: 1px solid #edf2f7; margin: 25px 0;" />
          <p style="font-size: 12px; color: #a0aec0; text-align: center;">&copy; Bold & Brilliant Girls. All rights reserved.</p>
        </div>
      `;

      if (bookingData.email) {
        await sendEmail({
          to: bookingData.email,
          subject: `Confirmed: Mentorship Session with ${bookingData.mentor}`,
          text: `Hi there,\n\nYour mentorship session with ${bookingData.mentor} is confirmed!\n\nDate: ${bookingData.date}\nTime: ${bookingData.time}\nDuration: ${bookingData.duration} minutes\nGoogle Meet: ${meetLink}\n\nWe've attached a calendar invite to this email. Please open it to save the session.`,
          html: studentHtml,
          attachments: [inviteAttachment]
        });
      }

      // 5. Send email to Mentor
      const mentorHtml = `
        <div style="font-family: sans-serif; padding: 25px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
          <h2 style="color: #6C5DD3; text-align: center;">New Mentorship Booking Scheduled!</h2>
          <p>Hello ${bookingData.mentor},</p>
          <p>You have a new mentorship booking from a student on the Bold & Brilliant Girls platform.</p>
          
          <div style="background-color: #f8fafc; border-left: 4px solid #6C5DD3; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
            <p style="margin: 0; font-weight: bold; color: #4338ca;">Booking Details:</p>
            <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #4338ca; line-height: 1.6;">
              <li><strong>Student Email:</strong> ${bookingData.email}</li>
              <li><strong>Date:</strong> ${bookingData.date}</li>
              <li><strong>Time:</strong> ${bookingData.time}</li>
              <li><strong>Duration:</strong> ${bookingData.duration} minutes</li>
              <li><strong>Google Meet Link:</strong> <a href="${meetLink}" style="color: #4338ca; font-weight: bold;">Join Google Meet</a></li>
            </ul>
          </div>
          <p>We've attached a calendar invite (<code>invite.ics</code>) to this email. Please open it to add the session to your calendar.</p>
          <p>Thank you for mentoring!</p>
          <hr style="border: 0; border-top: 1px solid #edf2f7; margin: 25px 0;" />
          <p style="font-size: 12px; color: #a0aec0; text-align: center;">&copy; Bold & Brilliant Girls. All rights reserved.</p>
        </div>
      `;

      if (mentorEmail) {
        await sendEmail({
          to: mentorEmail,
          subject: `New Booking: Mentorship Session with Student`,
          text: `Hello ${bookingData.mentor},\n\nYou have a new booking from a student (${bookingData.email})!\n\nDate: ${bookingData.date}\nTime: ${bookingData.time}\nDuration: ${bookingData.duration} minutes\nGoogle Meet: ${meetLink}\n\nWe've attached a calendar invite to this email. Please open it to save the session.`,
          html: mentorHtml,
          attachments: [inviteAttachment]
        });
      }
    } else {
      bookingData = submission.data;
    }

    res.json({ success: true, booking: bookingData });
  } catch (err) {
    console.error('Error verifying checkout session:', err);
    res.status(500).json({ message: 'Internal server error verifying session', error: err.message });
  }
});

/* ====================================================================
   CUSTOMER AUTHENTICATION & DASHBOARD ENDPOINTS
   ==================================================================== */
// POST /api/auth/register - Register customer
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email is already registered' });
    }

    const newUser = new User({
      name,
      email: cleanEmail,
      password,
      role: 'customer'
    });
    await newUser.save();

    const token = jwt.sign(
      { id: newUser._id, name: newUser.name, email: newUser.email, role: 'customer' },
      process.env.JWT_SECRET || 'supersecretjwtkeyforbbgplatform123!',
      { expiresIn: '7d' }
    );

    res.json({ success: true, token, name: newUser.name, email: newUser.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
});

// POST /api/auth/login - Login customer
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail, role: 'customer' });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email, role: 'customer' },
      process.env.JWT_SECRET || 'supersecretjwtkeyforbbgplatform123!',
      { expiresIn: '7d' }
    );

    res.json({ success: true, token, name: user.name, email: user.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

// POST /api/auth/firebase - Verify Firebase ID token and sync user profile
app.post('/api/auth/firebase', async (req, res) => {
  try {
    const { idToken, name, email } = req.body;
    if (!idToken) {
      return res.status(400).json({ success: false, message: 'ID token is required' });
    }

    let verifiedEmail = email ? email.trim().toLowerCase() : '';
    let verifiedName = name || '';
    let firebaseUid = '';

    // Handle developer / mock token bypass
    if (idToken === 'mock_firebase_token') {
      console.warn('Handling login in MOCK/DEVELOPER Firebase mode');
      if (!verifiedEmail) {
        return res.status(400).json({ success: false, message: 'Email required for mock firebase login' });
      }
      firebaseUid = `mock_uid_${verifiedEmail.replace(/[^a-zA-Z0-9]/g, '')}`;
    } else {
      // Securely verify ID token using Google Identity Toolkit API
      const apiKey = process.env.FIREBASE_API_KEY || '';
      if (!apiKey) {
        return res.status(500).json({ success: false, message: 'Firebase API Key is not configured on the backend.' });
      }

      const verifyRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken })
        }
      );

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.users || verifyData.users.length === 0) {
        return res.status(401).json({ success: false, message: 'Invalid or expired Firebase token' });
      }

      const firebaseUser = verifyData.users[0];
      verifiedEmail = firebaseUser.email ? firebaseUser.email.trim().toLowerCase() : verifiedEmail;
      verifiedName = firebaseUser.displayName || name || '';
      firebaseUid = firebaseUser.localId;
    }

    // Sync with MongoDB user record
    let user = await User.findOne({ email: verifiedEmail });
    if (!user) {
      // Create new customer account
      user = new User({
        email: verifiedEmail,
        name: verifiedName,
        role: 'customer',
        firebaseUid
      });
      await user.save();
      console.log('Created new MERN profile for social user:', verifiedEmail);
    } else {
      // Update Firebase UID if missing
      if (!user.firebaseUid) {
        user.firebaseUid = firebaseUid;
        await user.save();
        console.log('Mapped existing email to firebaseUid for user:', verifiedEmail);
      }
    }

    // Sign local MERN JWT
    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email, role: user.role || 'customer' },
      process.env.JWT_SECRET || 'supersecretjwtkeyforbbgplatform123!',
      { expiresIn: '7d' }
    );

    res.json({ success: true, token, name: user.name, email: user.email });
  } catch (err) {
    console.error('Error verifying Firebase token:', err);
    res.status(500).json({ success: false, message: 'Server error verifying Firebase token' });
  }
});

// GET /api/user/bookings - Get customer bookings (synchronized by email)
app.get('/api/user/bookings', userAuth, async (req, res) => {
  try {
    const email = req.user.email;
    const bookings = await Submission.find({
      form_type: 'mentorship',
      'data.email': email
    }).sort({ created_at: -1 });

    res.json({ success: true, bookings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error fetching bookings' });
  }
});

// PUT /api/user/bookings/:id/reschedule-request - Customer requests a reschedule
app.put('/api/user/bookings/:id/reschedule-request', userAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { date, time } = req.body;
    const email = req.user.email;

    if (!date || !time) {
      return res.status(400).json({ success: false, message: 'Date and time are required for rescheduling.' });
    }

    const booking = await Submission.findById(id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    // Security check: Verify owner
    if (booking.data.email !== email) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to this booking.' });
    }

    // Availability validation check
    const toMinutes = (timeStr) => {
      const [h, m] = timeStr.split(':').map(Number);
      return h * 60 + m;
    };

    const requestedStart = toMinutes(time);
    const duration = parseInt(booking.data.duration) || 30;
    const requestedEnd = requestedStart + duration;

    // Check overlaps on that date (excluding this booking itself)
    const otherBookings = await Submission.find({
      _id: { $ne: booking._id },
      form_type: 'mentorship',
      status: { $ne: 'spam' },
      $or: [
        { 'data.mentor_id': booking.data.mentor_id },
        { 'data.mentor_id': String(booking.data.mentor_id) }
      ],
      'data.date': date
    });

    const hasOverlap = otherBookings.some(b => {
      const startMins = toMinutes(b.data.time);
      const dur = parseInt(b.data.duration) || 30;
      const endMins = startMins + dur;
      return (requestedStart >= startMins && requestedStart < endMins) ||
        (requestedEnd > startMins && requestedEnd <= endMins) ||
        (requestedStart <= startMins && requestedEnd >= endMins);
    });

    if (hasOverlap) {
      return res.status(400).json({ success: false, message: 'The requested time slot overlaps with another booking. Please select another slot.' });
    }

    // Check if slot falls in static busy blocks
    let isStaticBusy = false;
    if (mongoose.Types.ObjectId.isValid(booking.data.mentor_id)) {
      const mentor = await Mentor.findById(booking.data.mentor_id);
      if (mentor && mentor.busy && mentor.busy.includes(time)) {
        isStaticBusy = true;
      }
    }

    if (isStaticBusy) {
      return res.status(400).json({ success: false, message: 'The mentor is unavailable during this time slot. Please select another slot.' });
    }

    // Update reschedule request status
    booking.data.reschedule_request = {
      date,
      time,
      status: 'pending',
      requested_at: new Date().toISOString()
    };
    booking.markModified('data');
    await booking.save();

    // Send email alert to mentor
    let mentorEmail = '';
    if (booking.data.mentor_id && mongoose.Types.ObjectId.isValid(booking.data.mentor_id)) {
      const dbMentor = await Mentor.findById(booking.data.mentor_id);
      if (dbMentor && dbMentor.email) {
        mentorEmail = dbMentor.email;
      }
    }

    if (mentorEmail) {
      sendEmail({
        to: mentorEmail,
        subject: `Action Required: Reschedule Request for Mentorship with ${booking.data.email}`,
        text: `Hello,\n\nA student has requested to reschedule their session with you.\n\nOriginal Time: ${booking.data.date} at ${booking.data.time}\nProposed Time: ${date} at ${time}\n\nPlease log in to your Mentor Dashboard to accept or decline this request.`,
        html: `
          <div style="font-family: sans-serif; padding: 25px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px;">
            <h2 style="color: #6C5DD3; text-align: center;">Reschedule Request</h2>
            <p>Hello,</p>
            <p>A student has submitted a request to reschedule their upcoming mentorship session with you.</p>
            <div style="background-color: #f8fafc; border-left: 4px solid #6C5DD3; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0 0 8px 0;"><strong>Original Schedule:</strong> ${booking.data.date} at ${booking.data.time}</p>
              <p style="margin: 0;"><strong>Proposed New Schedule:</strong> <span style="color: #4f46e5; font-weight: bold;">${date} at ${time}</span> (${booking.data.duration} mins)</p>
            </div>
            <p>Please log in to your Mentor Dashboard to accept or decline this request.</p>
            <div style="text-align: center; margin-top: 25px;">
              <a href="https://bnbgirl.com/mentor-dashboard" style="background-color: #6C5DD3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Go to Mentor Portal</a>
            </div>
          </div>
        `
      });
    }

    res.json({ success: true, booking });
  } catch (err) {
    console.error('Error requesting reschedule:', err);
    res.status(500).json({ success: false, message: 'Server error requesting reschedule', error: err.message });
  }
});


// GET /api/cms - Public CMS content endpoint
app.get('/api/cms', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const dbOptions = await Option.find({ key: /^cms_/ });
    const cms = {};
    dbOptions.forEach(opt => {
      cms[opt.key] = opt.value;
    });
    res.json(cms);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching CMS content' });
  }
});

/* ====================================================================
   ADMIN AUTH ENDPOINTS
   ==================================================================== */

app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET || 'supersecretjwtkeyforbbgplatform123!',
      { expiresIn: '7d' }
    );

    res.json({ success: true, token, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Login server error' });
  }
});

app.get('/api/admin/verify', auth, (req, res) => {
  res.json({ success: true, username: req.admin.username });
});

/* ====================================================================
   ADMIN CRUD ENDPOINTS (PROTECTED BY JWT AUTH)
   ==================================================================== */

// Upload handler
app.post('/api/admin/upload', auth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }
  try {
    if (isCloudinaryConfigured) {
      // Upload to Cloudinary
      const result = await cloudinary.uploader.upload(req.file.path, {
        resource_type: 'auto',
        folder: 'bbg_platform'
      });
      // Delete temporary local file
      fs.unlinkSync(req.file.path);
      return res.json({ success: true, url: result.secure_url, filename: req.file.filename });
    } else {
      // Local storage fallback
      const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
      return res.json({ success: true, url: fileUrl, filename: req.file.filename });
    }
  } catch (err) {
    console.error('Upload error:', err);
    // Cleanup local file if it still exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(500).json({ success: false, message: 'Upload failed: ' + err.message });
  }
});

// EPISODES CRUD
app.get('/api/admin/episodes', auth, async (req, res) => {
  try {
    const search = req.query.search;
    const query = {};
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { guest_name: { $regex: search, $options: 'i' } }
      ];
    }
    const episodes = await Episode.find(query)
      .populate('category_id')
      .populate('subcategory_id')
      .populate('specialized_field_id')
      .sort({ created_at: -1 });
    res.json(episodes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/admin/episodes', auth, async (req, res) => {
  try {
    const ep = new Episode(req.body);
    await ep.save();
    res.json({ success: true, data: ep });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/admin/episodes/:id', auth, async (req, res) => {
  try {
    const ep = await Episode.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!ep) return res.status(404).json({ message: 'Episode not found' });
    res.json({ success: true, data: ep });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete('/api/admin/episodes/:id', auth, async (req, res) => {
  try {
    const ep = await Episode.findByIdAndDelete(req.params.id);
    if (!ep) return res.status(404).json({ message: 'Episode not found' });
    res.json({ success: true, message: 'Episode deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// MENTORS CRUD
app.get('/api/admin/mentors', auth, async (req, res) => {
  try {
    const mentors = await Mentor.find()
      .populate('category_id')
      .populate('specialized_field_id')
      .populate('episode_id')
      .sort({ created_at: -1 });
    res.json(mentors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/admin/mentors', auth, async (req, res) => {
  try {
    const m = new Mentor(req.body);
    await m.save();
    res.json({ success: true, data: m });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/admin/mentors/:id', auth, async (req, res) => {
  try {
    const m = await Mentor.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!m) return res.status(404).json({ message: 'Mentor not found' });
    res.json({ success: true, data: m });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete('/api/admin/mentors/:id', auth, async (req, res) => {
  try {
    const m = await Mentor.findByIdAndDelete(req.params.id);
    if (!m) return res.status(404).json({ message: 'Mentor not found' });
    res.json({ success: true, message: 'Mentor deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// MENTOR APPLICATIONS CRUD
app.get('/api/admin/mentor-applications', auth, async (req, res) => {
  try {
    const apps = await MentorApplication.find().sort({ created_at: -1 });
    res.json(apps);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/admin/mentor-applications/:id/accept', auth, async (req, res) => {
  try {
    const appRecord = await MentorApplication.findById(req.params.id);
    if (!appRecord) {
      return res.status(404).json({ message: 'Mentor application not found' });
    }

    if (appRecord.status === 'accepted') {
      return res.status(400).json({ message: 'Application is already accepted' });
    }

    appRecord.status = 'accepted';
    await appRecord.save();

    // Generate a temporary password for the mentor login
    const tempPassword = Math.random().toString(36).slice(-8);

    // Create a Mentor record in the DB
    const newMentor = new Mentor({
      name: appRecord.name,
      email: appRecord.email,
      password: tempPassword,
      role: appRecord.role,
      photo: appRecord.photo,
      bio: appRecord.bio,
      linkedin: appRecord.linkedin,
      expertise_areas: appRecord.expertise,
      status: 'published'
    });
    await newMentor.save();

    // Send email to applicant with credentials
    let emailSent = false;
    let emailError = null;
    try {
      const emailResult = await sendEmail({
        to: appRecord.email,
        subject: '🎉 Congratulations! Your mentorship application has been accepted!',
        text: `Hello ${appRecord.name},\n\nWe are delighted to inform you that your mentor application has been accepted!\n\nYour profile has been created and is now live on the Bold & Brilliant Girls platform. You can find your profile under the mentorship directory.\n\nHere are your login credentials to manage your profile and bookings:\n- Login Link: https://bnbgirl.com/mentor-dashboard\n- Email: ${appRecord.email}\n- Temporary Password: ${tempPassword}\n\nThank you for joining us to empower young girls!\n\nBest regards,\nBold & Brilliant Girls Team`,
        html: `
          <div style="font-family: sans-serif; padding: 25px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
            <div style="text-align: center; margin-bottom: 20px;">
              <span style="font-size: 48px;">🎉</span>
            </div>
            <h2 style="color: #6C5DD3; text-align: center; margin-top: 10px;">Application Accepted!</h2>
            <p>Dear <strong>${appRecord.name}</strong>,</p>
            <p>We are absolutely thrilled to inform you that your application to become a mentor on the <strong>Bold & Brilliant Girls</strong> platform has been <strong>accepted</strong>!</p>
            <p>Your professional profile is now live in our mentor directory, making it visible to students and young girls looking for guidance, inspiration, and mentorship.</p>
            
            <div style="background-color: #f7fafc; border-left: 4px solid #6C5DD3; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; font-weight: bold; color: #4a5568;">Your Mentor Profile Details:</p>
              <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #4a5568; line-height: 1.6;">
                <li><strong>Name:</strong> ${appRecord.name}</li>
                <li><strong>Role:</strong> ${appRecord.role || 'N/A'}</li>
                <li><strong>Expertise:</strong> ${appRecord.expertise || 'N/A'}</li>
              </ul>
            </div>

            <div style="background-color: #fef08a; border-left: 4px solid #ca8a04; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; font-weight: bold; color: #854d0e;">Your Mentor Portal Credentials:</p>
              <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #854d0e; line-height: 1.6;">
                <li><strong>Login Link:</strong> <a href="https://bnbgirl.com/mentor-dashboard" style="color: #ca8a04; text-decoration: underline;">bnbgirl.com/mentor-dashboard</a></li>
                <li><strong>Email:</strong> ${appRecord.email}</li>
                <li><strong>Temporary Password:</strong> <code style="background: rgba(0,0,0,0.05); padding: 2px 4px; border-radius: 4px;">${tempPassword}</code></li>
              </ul>
              <p style="margin: 10px 0 0 0; font-size: 12px; color: #854d0e;">Please log in using these details and update your password in the profile settings.</p>
            </div>

            <p>Students will now be able to view your background and book interactive sessions with you based on your availability.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="https://bnbgirl.com/mentorship" style="background-color: #6C5DD3; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">View Mentor Directory</a>
            </div>

            <p>Thank you for your commitment to fostering and empowering the next generation of female leaders and innovators. We are honored to have you on board!</p>
            
            <hr style="border: 0; border-top: 1px solid #edf2f7; margin: 25px 0;" />
            <p style="font-size: 12px; color: #a0aec0; text-align: center;">&copy; ${new Date().getFullYear()} Bold & Brilliant Girls. All rights reserved.</p>
          </div>
        `
      });
      emailSent = emailResult ? emailResult.success : false;
      if (emailResult && !emailResult.success) {
        emailError = emailResult.message || emailResult.error;
      }
    } catch (err) {
      console.error('Email sending error:', err);
      emailError = err.message;
    }

    res.json({
      success: true,
      message: emailSent
        ? 'Application accepted and Mentor profile created'
        : `Application accepted and Mentor profile created, but email could not be sent: ${emailError || 'SMTP credentials are not configured on Render.'}`,
      data: appRecord,
      mentor: newMentor,
      emailSent,
      emailError
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/admin/mentor-applications/:id/reject', auth, async (req, res) => {
  try {
    const appRecord = await MentorApplication.findById(req.params.id);
    if (!appRecord) {
      return res.status(404).json({ message: 'Mentor application not found' });
    }

    if (appRecord.status === 'rejected') {
      return res.status(400).json({ message: 'Application is already rejected' });
    }

    appRecord.status = 'rejected';
    await appRecord.save();

    // Send polite rejection email
    sendEmail({
      to: appRecord.email,
      subject: 'Update on your mentorship application - Bold & Brilliant Girls',
      text: `Hello ${appRecord.name},\n\nThank you for your application and interest in becoming a mentor on Bold & Brilliant Girls.\n\nAfter careful consideration, we regret to inform you that we are unable to accept your application at this time. We received a high volume of applications and had to make some very difficult decisions.\n\nWe appreciate your time, effort, and interest in our mission. We wish you the very best in your professional endeavors.\n\nBest regards,\nBold & Brilliant Girls Team`,
      html: `
        <div style="font-family: sans-serif; padding: 25px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #4a5568; text-align: center;">Mentor Application Update</h2>
          <p>Dear <strong>${appRecord.name}</strong>,</p>
          <p>Thank you for submitting your application to become a mentor on the <strong>Bold & Brilliant Girls</strong> platform.</p>
          <p>After careful review of your application and background, we regret to inform you that we are unable to accept your application at this time. We receive many applications from outstanding professionals, and we have to make difficult choices to keep our current mentor cohort balanced across various domains and experience levels.</p>
          <p>Please note that this decision does not reflect on your professional achievements or qualifications. We highly appreciate your willingness to support young girls in their tech and career journeys.</p>
          <p>We will keep your details on file and may reach out in the future as our mentoring needs evolve.</p>
          <p>Thank you again for your time, effort, and interest in our mission. We wish you all the best in your professional endeavors.</p>
          
          <hr style="border: 0; border-top: 1px solid #edf2f7; margin: 25px 0;" />
          <p style="font-size: 12px; color: #a0aec0; text-align: center;">&copy; ${new Date().getFullYear()} Bold & Brilliant Girls. All rights reserved.</p>
        </div>
      `
    });

    res.json({ success: true, message: 'Application rejected', data: appRecord });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete('/api/admin/mentor-applications/:id', auth, async (req, res) => {
  try {
    const appRecord = await MentorApplication.findByIdAndDelete(req.params.id);
    if (!appRecord) return res.status(404).json({ message: 'Mentor application not found' });
    res.json({ success: true, message: 'Mentor application deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// RESOURCES CRUD
app.get('/api/admin/resources', auth, async (req, res) => {
  try {
    const resources = await Resource.find()
      .populate('category_id')
      .populate('subcategory_id')
      .populate('specialized_field_id')
      .sort({ sort_order: 1, created_at: -1 });
    res.json(resources);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/admin/resources', auth, async (req, res) => {
  try {
    const r = new Resource(req.body);
    await r.save();
    res.json({ success: true, data: r });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/admin/resources/:id', auth, async (req, res) => {
  try {
    const r = await Resource.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!r) return res.status(404).json({ message: 'Resource not found' });
    res.json({ success: true, data: r });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete('/api/admin/resources/:id', auth, async (req, res) => {
  try {
    const r = await Resource.findByIdAndDelete(req.params.id);
    if (!r) return res.status(404).json({ message: 'Resource not found' });
    res.json({ success: true, message: 'Resource deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// CATEGORIES CRUD
app.post('/api/admin/categories', auth, async (req, res) => {
  try {
    // Generate unique slug
    let slug = req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const exists = await Category.findOne({ slug });
    if (exists) {
      slug = `${slug}-${Date.now().toString().slice(-4)}`;
    }
    const cat = new Category({ ...req.body, slug });
    await cat.save();
    res.json({ success: true, data: cat });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/admin/categories/:id', auth, async (req, res) => {
  try {
    const cat = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!cat) return res.status(404).json({ message: 'Category not found' });
    res.json({ success: true, data: cat });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete('/api/admin/categories/:id', auth, async (req, res) => {
  try {
    const catId = req.params.id;
    const cat = await Category.findByIdAndDelete(catId);
    if (!cat) return res.status(404).json({ message: 'Category not found' });
    // Delete cascading subcategories too
    await Subcategory.deleteMany({ category_id: catId });
    res.json({ success: true, message: 'Category and its subcategories deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// SUBCATEGORIES CRUD
app.post('/api/admin/subcategories', auth, async (req, res) => {
  try {
    const { category_id, name, sort_order } = req.body;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const sub = new Subcategory({ category_id, name, slug, sort_order });
    await sub.save();
    res.json({ success: true, data: sub });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/admin/subcategories/:id', auth, async (req, res) => {
  try {
    const sub = await Subcategory.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!sub) return res.status(404).json({ message: 'Subcategory not found' });
    res.json({ success: true, data: sub });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete('/api/admin/subcategories/:id', auth, async (req, res) => {
  try {
    const subId = req.params.id;
    const sub = await Subcategory.findByIdAndDelete(subId);
    if (!sub) return res.status(404).json({ message: 'Subcategory not found' });
    // Cascading delete Level 3 Specialized Fields
    await SpecializedField.deleteMany({ subcategory_id: subId });
    res.json({ success: true, message: 'Subcategory deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// SPECIALIZED FIELDS (LEVEL 3) CRUD
app.get('/api/admin/specialized-fields', auth, async (req, res) => {
  try {
    const fields = await SpecializedField.find()
      .populate({
        path: 'subcategory_id',
        populate: { path: 'category_id' }
      })
      .sort({ sort_order: 1, name: 1 });
    res.json(fields);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/admin/specialized-fields', auth, async (req, res) => {
  try {
    const { subcategory_id, name, sort_order } = req.body;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const sf = new SpecializedField({ subcategory_id, name, slug, sort_order });
    await sf.save();
    res.json({ success: true, data: sf });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/admin/specialized-fields/:id', auth, async (req, res) => {
  try {
    const sf = await SpecializedField.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!sf) return res.status(404).json({ message: 'Specialized field not found' });
    res.json({ success: true, data: sf });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete('/api/admin/specialized-fields/:id', auth, async (req, res) => {
  try {
    const sf = await SpecializedField.findByIdAndDelete(req.params.id);
    if (!sf) return res.status(404).json({ message: 'Specialized field not found' });
    res.json({ success: true, message: 'Specialized field deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// SUBMISSIONS MANAGEMENT
app.get('/api/admin/submissions', auth, async (req, res) => {
  try {
    const { tab, status, s, page = 1 } = req.query;
    const perPage = 30;

    const query = {};
    if (tab) query.form_type = tab;
    if (status) query.status = status;
    if (s) {
      // Deep search in data object using MongoDB wildcard or string matching on data representation
      query.$or = [
        { 'data.name': { $regex: s, $options: 'i' } },
        { 'data.email': { $regex: s, $options: 'i' } },
        { 'data.question': { $regex: s, $options: 'i' } },
        { 'data.suggestion': { $regex: s, $options: 'i' } },
        { 'data.pitch': { $regex: s, $options: 'i' } },
        { 'data.motivation': { $regex: s, $options: 'i' } }
      ];
    }

    const total = await Submission.countDocuments(query);
    const rows = await Submission.find(query)
      .sort({ created_at: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage);

    // Calculate aggregated counts for frontend badges
    const forms = ['ask_guest', 'suggest_guest', 'community', 'quiz', 'mentorship', 'guest_apply', 'mentor_apply'];
    const counts = { total: await Submission.countDocuments({}) };
    for (const f of forms) {
      counts[f] = await Submission.countDocuments({ form_type: f });
    }

    res.json({ rows, total, counts });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/admin/submissions/:id', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const sub = await Submission.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!sub) return res.status(404).json({ message: 'Submission not found' });
    res.json({ success: true, data: sub });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// CSV EXPORT (Streams CSV directly to response)
app.get('/api/admin/submissions/export', auth, async (req, res) => {
  try {
    const { form } = req.query;

    // Header setup
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=bbg-export-${form || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`);

    const writeRow = (arr) => {
      // Escape CSV columns
      const escaped = arr.map(val => {
        let s = String(val === null || val === undefined ? '' : val);
        s = s.replace(/"/g, '""');
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          s = `"${s}"`;
        }
        return s;
      });
      res.write(escaped.join(',') + '\r\n');
    };

    const formsLabels = {
      'ask_guest': 'Ask a Guest',
      'suggest_guest': 'Suggest a Guest',
      'community': 'Join Community',
      'quiz': 'Quiz Results',
      'mentorship': 'Mentorship Apply',
      'guest_apply': 'Be Our Guest',
      'mentor_apply': 'Join as Mentor'
    };

    const getCols = (f) => {
      const mapping = {
        'ask_guest': ['name', 'email', 'question', 'guest_for'],
        'suggest_guest': ['name', 'email', 'field', 'suggestion'],
        'community': ['name', 'email', 'age', 'field', 'dream', 'source'],
        'quiz': ['name', 'email', 'stage', 'result', 'match_pct', 'answers'],
        'mentorship': ['name', 'email', 'field', 'stage', 'goals', 'urgency', 'session_pref', 'linkedin', 'context'],
        'guest_apply': ['name', 'email', 'job_title', 'organisation', 'social_link', 'language', 'pitch', 'motivation', 'comfort', 'found_via'],
        'mentor_apply': ['name', 'email', 'job_title', 'organisation', 'years_exp', 'linkedin', 'expertise', 'motivation', 'hours', 'format', 'language', 'found_via']
      };
      return mapping[f] || ['name', 'email'];
    };

    if (form && formsLabels[form]) {
      // Export single form type
      const submissions = await Submission.find({ form_type: form }).sort({ created_at: -1 });
      const cols = getCols(form);

      // Header row
      writeRow(['ID', 'Date', 'Status', ...cols.map(c => c.toUpperCase().replace('_', ' '))]);

      submissions.forEach(sub => {
        const d = sub.data || {};
        const row = [
          sub._id.toString(),
          sub.created_at.toISOString(),
          sub.status,
          ...cols.map(c => typeof d[c] === 'object' ? JSON.stringify(d[c]) : d[c] || '')
        ];
        writeRow(row);
      });
    } else {
      // Export all forms concatenated
      for (const [key, label] of Object.entries(formsLabels)) {
        writeRow([`=== ${label} submissions ===`]);
        const submissions = await Submission.find({ form_type: key }).sort({ created_at: -1 });
        const cols = getCols(key);

        writeRow(['ID', 'Date', 'Status', ...cols.map(c => c.toUpperCase().replace('_', ' '))]);
        submissions.forEach(sub => {
          const d = sub.data || {};
          const row = [
            sub._id.toString(),
            sub.created_at.toISOString(),
            sub.status,
            ...cols.map(c => typeof d[c] === 'object' ? JSON.stringify(d[c]) : d[c] || '')
          ];
          writeRow(row);
        });
        writeRow([]); // Blank separator
      }
    }

    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Export failed' });
    }
  }
});

// DASHBOARD STATS API
app.get('/api/admin/dashboard-stats', auth, async (req, res) => {
  try {
    const totalEpisodes = await Episode.countDocuments({});
    const publishedEpisodes = await Episode.countDocuments({ status: 'published' });
    const draftEpisodes = await Episode.countDocuments({ status: 'draft' });

    // Mentors count (Consolidated - Episode-based mentors + Dedicated mentors)
    const epMentorsCount = await Episode.countDocuments({ is_mentor: true, status: 'published' });
    const dedicatedCount = await Mentor.countDocuments({ status: 'published' });
    const totalMentors = epMentorsCount + dedicatedCount;

    const totalResources = await Resource.countDocuments({});
    const publishedResources = await Resource.countDocuments({ status: 'published' });
    const draftResources = await Resource.countDocuments({ status: 'draft' });

    const totalSubmissions = await Submission.countDocuments({});

    // Status breakdown
    const submissionsByStatus = {
      new: await Submission.countDocuments({ status: 'new' }),
      reviewed: await Submission.countDocuments({ status: 'reviewed' }),
      actioned: await Submission.countDocuments({ status: 'actioned' }),
      spam: await Submission.countDocuments({ status: 'spam' })
    };

    // Form Type breakdown
    const forms = ['ask_guest', 'suggest_guest', 'community', 'quiz', 'mentorship', 'guest_apply', 'mentor_apply'];
    const submissionsByFormType = {};
    for (const f of forms) {
      submissionsByFormType[f] = await Submission.countDocuments({ form_type: f });
    }

    // Categories breakdown
    const categories = await Category.find().lean();
    const categoriesBreakdown = [];
    for (const cat of categories) {
      const epCount = await Episode.countDocuments({ category_id: cat._id });
      const resCount = await Resource.countDocuments({ category_id: cat._id });
      const mentorCount = await Mentor.countDocuments({ category_id: cat._id });
      categoriesBreakdown.push({
        id: cat._id,
        name: cat.name,
        color: cat.color,
        icon: cat.icon,
        episodes: epCount,
        resources: resCount,
        mentors: mentorCount
      });
    }

    // Submissions over time (last 7 days)
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const start = d;
      const end = new Date(d);
      end.setDate(end.getDate() + 1);

      const count = await Submission.countDocuments({
        created_at: { $gte: start, $lt: end }
      });

      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      last7Days.push({ day: dayName, date: d.toISOString().slice(0, 10), count });
    }

    // Get live stats from Options
    const keys = ['episodes', 'mentors', 'community', 'downloads', 'countries', 'response', 'industries', 'views', 'views_unit'];
    const dbOptions = await Option.find({ key: { $in: keys.map(k => `bbg_stat_${k}`) } });
    const liveStats = {};
    keys.forEach(k => {
      liveStats[k] = k === 'views_unit' ? 'M+' : '0';
    });
    dbOptions.forEach(opt => {
      const keyName = opt.key.replace('bbg_stat_', '');
      liveStats[keyName] = opt.value;
    });

    res.json({
      episodes: { total: totalEpisodes, published: publishedEpisodes, draft: draftEpisodes },
      mentors: { total: totalMentors, epMentors: epMentorsCount, dedicated: dedicatedCount },
      resources: { total: totalResources, published: publishedResources, draft: draftResources },
      submissions: { total: totalSubmissions, byStatus: submissionsByStatus, byFormType: submissionsByFormType, last7Days },
      categories: categoriesBreakdown,
      liveStats
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching dashboard stats' });
  }
});

// STATS OPTIONS API
app.get('/api/admin/stats', auth, async (req, res) => {
  try {
    const keys = ['episodes', 'mentors', 'community', 'downloads', 'countries', 'response', 'industries', 'views', 'views_unit'];
    const dbOptions = await Option.find({ key: { $in: keys.map(k => `bbg_stat_${k}`) } });

    const stats = {};
    keys.forEach(k => {
      stats[k] = k === 'views_unit' ? 'M+' : '0';
    });
    dbOptions.forEach(opt => {
      const keyName = opt.key.replace('bbg_stat_', '');
      stats[keyName] = opt.value;
    });

    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/admin/stats', auth, async (req, res) => {
  try {
    const stats = req.body;
    for (const [k, v] of Object.entries(stats)) {
      await Option.findOneAndUpdate(
        { key: `bbg_stat_${k}` },
        { value: String(v) },
        { upsert: true, new: true }
      );
    }
    res.json({ success: true, message: 'Stats updated' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// SETTINGS OPTIONS API
app.get('/api/admin/settings', auth, async (req, res) => {
  try {
    const emailOpt = await Option.findOne({ key: 'bbg_email' }) || { value: 'sanah@bnbgirl.com' };
    const emailOnSubmitOpt = await Option.findOne({ key: 'bbg_email_on_submit' }) || { value: '1' };
    const quizGateOpt = await Option.findOne({ key: 'bbg_quiz_gate' }) || { value: '1' };

    res.json({
      bbg_email: emailOpt.value,
      bbg_email_on_submit: emailOnSubmitOpt.value === '1',
      bbg_quiz_gate: quizGateOpt.value === '1'
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/admin/settings', auth, async (req, res) => {
  try {
    const { bbg_email, bbg_email_on_submit, bbg_quiz_gate } = req.body;

    await Option.findOneAndUpdate({ key: 'bbg_email' }, { value: bbg_email }, { upsert: true });
    await Option.findOneAndUpdate({ key: 'bbg_email_on_submit' }, { value: bbg_email_on_submit ? '1' : '0' }, { upsert: true });
    await Option.findOneAndUpdate({ key: 'bbg_quiz_gate' }, { value: bbg_quiz_gate ? '1' : '0' }, { upsert: true });

    res.json({ success: true, message: 'Settings saved' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// CMS OPTIONS API
app.get('/api/admin/cms', auth, async (req, res) => {
  try {
    const dbOptions = await Option.find({ key: /^cms_/ });
    const cms = {};
    dbOptions.forEach(opt => {
      cms[opt.key] = opt.value;
    });
    res.json(cms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/admin/cms', auth, async (req, res) => {
  try {
    const cmsData = req.body;
    for (const [k, v] of Object.entries(cmsData)) {
      if (k.startsWith('cms_')) {
        await Option.findOneAndUpdate(
          { key: k },
          { value: String(v) },
          { upsert: true, new: true }
        );
      }
    }
    res.json({ success: true, message: 'CMS updated successfully' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

const cmsDefaults = {
  cms_navbar_logo: "/logo-main.png",
  cms_footer_tagline: "Real Stories. Real Women. Real Possibilities. Empowering the next generation of female leaders through authentic conversations and meaningful mentorship.",
  cms_footer_social_insta: "https://instagram.com/bnbgirls.podcast",
  cms_footer_social_yt: "https://www.youtube.com/@BoldandBrilliantgirl",
  cms_footer_privacy_link: "https://bnbgirl.com/privacy-policy/",
  cms_footer_terms_link: "https://bnbgirl.com/terms-of-service/",
  cms_footer_copyright: "&copy; 2026 <span>Bold &amp; Brilliant Girls Podcast</span>. Made with 💜 for every bold and brilliant girl.",
  cms_hero_eyebrow: "New Episode Live Now",
  cms_hero_title: "Bold &amp; <em class=\"gold\">Brilliant</em> Girls",
  cms_hero_subtitle: "Real stories from inspiring women across every career — so you can see what's possible for you.",
  cms_hero_cta_primary_text: "Watch Now",
  cms_hero_cta_secondary_text: "Find a Mentor →",
  cms_hero_social_proof: "Loved by 50+ bold women",
  cms_mission_kicker: "Our Purpose",
  cms_mission_statement: "\"Every young woman deserves to see herself in the women who came before her — and to know that her ambitions are not just possible, but inevitable.\"",
  cms_mission_body: "We connect ambitious young women with accomplished role models through honest conversations, mentorship, and community. No noise. Just stories that change careers.",
  cms_mission_author: "— The Bold &amp; Brilliant Girls Team",
  cms_why_eyebrow: "What We Offer",
  cms_why_title: "Why <span class=\"grad\">Bold &amp; Brilliant</span> Girls?",
  cms_why_subtitle: "Every young woman deserves guidance to transform her career aspirations into reality.",
  cms_why_card1_kicker: "Deep-dive conversations", cms_why_card1_title: "Podcast Episodes", cms_why_card1_desc: "Inspiring conversations with accomplished women — designed for curious minds and busy schedules. Each episode is a career masterclass.", cms_why_card1_cta: "Listen Now →",
  cms_why_card2_kicker: "1-on-1 guidance", cms_why_card2_title: "Mentorship", cms_why_card2_desc: "Connect directly with professionals who've walked the path you want to walk. Real mentors, real impact.", cms_why_card2_cta: "Apply Now →",
  cms_why_card3_kicker: "Free downloads", cms_why_card3_title: "Resource Library", cms_why_card3_desc: "Beautiful PDFs, guides, and templates distilling each episode into actionable career tools — completely free.", cms_why_card3_cta: "Browse PDFs →",
  cms_why_card4_kicker: "Safe space", cms_why_card4_title: "Community", cms_why_card4_desc: "A supportive network of like-minded girls where you can share goals, solve problems, and grow together.", cms_why_card4_cta: "Join Now →",
  cms_about_host_photo: "https://bnbgirl.com/wp-content/uploads/2026/04/WhatsApp-Image-2026-04-11-at-4.25.42-AM.jpeg",
  cms_about_ticker: "Bold and Brilliant Girls; Podcast for Teens; Dream Boldly; Real Careers · Real Stories; Kent Place School · Summit NJ",
  cms_about_eyebrow_badge: "Podcast Host and Creator",
  cms_about_eyebrow_school: "Kent Place · Summit, NJ",
  cms_about_hero_name: "Sanah",
  cms_about_hero_desc: "A podcast dedicated to helping teens and young women explore different career paths — and discover what's truly possible for their future.",
  cms_about_story_title: "The moment that changed <span class=\"hot\">everything.</span>",
  cms_about_story_body: "Freshman year of high school hit differently than I expected. It wasn't just the academics — it was the constant pressure of a question nobody seemed to answer well:<br/><br/><em>\"What do you want to do with your life?\"</em><br/><br/>Advice came from every direction, with completely different ideas of what success should look like. And somehow, none of it felt like <em>mine.</em>",
  cms_about_chapter1_label: "The Overwhelm", cms_about_chapter1_title: "Too many voices, too little clarity", cms_about_chapter1_body: "Walking into high school, I felt the weight of everyone else's expectations. My dad had a vision. My friends had opinions. None of it felt authentic to who I actually was.",
  cms_about_chapter2_label: "The Realization", cms_about_chapter2_title: "I wasn't alone in this", cms_about_chapter2_body: "When I opened up to my friends, I discovered they felt exactly the same — the same confusion, the same pressure. That shared moment of honesty changed everything.",
  cms_about_chapter3_label: "The Question", cms_about_chapter3_title: "What if we could hear from real people?", cms_about_chapter3_body: "Not textbooks. Not career quizzes. Real professionals who had walked interesting, unexpected paths — sharing their journeys in a way no classroom ever could.",
  cms_about_chapter4_label: "The Creation", cms_about_chapter4_title: "Bold and Brilliant Girls is born", cms_about_chapter4_body: "That question became a podcast — a space for teens and young women to explore careers through authentic conversations, without pressure to have it all figured out.",
  cms_about_quote_text: "I wanted to build something that encourages <span class=\"qs-pop\">curiosity,</span> empowers young women, and helps the next generation dream <span class=\"qs-pop\">boldly</span> while exploring their own unique paths.",
  cms_about_quote_attr: "Sanah · Founder, Bold and Brilliant Girls",
  cms_about_pillar1_title: "Authentic Voices", cms_about_pillar1_body: "Real professionals. Real stories. No filters, no corporate speak — just honest conversations about careers, struggles, and breakthroughs.",
  cms_about_pillar2_title: "Curious Community", cms_about_pillar2_body: "A supportive space where young women can ask big questions, challenge assumptions, and explore paths they never thought were possible.",
  cms_about_pillar3_title: "Bold Futures", cms_about_pillar3_body: "Helping the next generation define success on their own terms — not someone else's timeline, blueprint, or definition of achievement.",
  cms_about_hobby1_name: "Swimming", cms_about_hobby1_desc: "Training in the water taught me that progress is invisible until it suddenly isn't. Every lap is a quiet lesson in showing up even when no one's watching.", cms_about_hobby1_pill: "Discipline",
  cms_about_hobby2_name: "Golf", cms_about_hobby2_desc: "Golf is patience made physical. It's just you, the course, and your mind — and learning to reset after a bad shot is a skill that transfers everywhere.", cms_about_hobby2_pill: "Resilience",
  cms_about_hobby3_name: "Skiing", cms_about_hobby3_desc: "Skiing taught me to move toward the things that scare me. On a steep slope, hesitation is more dangerous than going for it — a truth that lives off the mountain too.", cms_about_hobby3_pill: "Confidence",
  cms_about_player_title: "Bold and Brilliant Girls",
  cms_about_player_sub: "New episodes every week · Real stories, real paths",
  cms_about_listen_title: "Ready to start <span class=\"hot\">listening?</span>",
  cms_about_listen_body: "Each episode features a real professional sharing their path — the pivots, the surprises, and the advice they wish someone had given them. Perfect for every young woman figuring out her next step.",
  cms_about_contact_email: "sanah@bnbgirl.com",
  // Series / Curated Collections CMS
  cms_series_stem_title: "Women in STEM", cms_series_stem_epcount: "8 Episodes", cms_series_stem_category: "tech", cms_series_stem_youtube: "", cms_series_stem_percentage: "25%",
  cms_series_entrepreneurship_title: "Entrepreneurship Diaries", cms_series_entrepreneurship_epcount: "6 Episodes", cms_series_entrepreneurship_category: "business", cms_series_entrepreneurship_youtube: "", cms_series_entrepreneurship_percentage: "0%",
  cms_series_mental_title: "Mental Health & Career", cms_series_mental_epcount: "4 Episodes", cms_series_mental_category: "health", cms_series_mental_youtube: "", cms_series_mental_percentage: "50%",
  cms_series_law_title: "Breaking Barriers in Law", cms_series_law_epcount: "5 Episodes", cms_series_law_category: "law", cms_series_law_youtube: "", cms_series_law_percentage: "0%",
  cms_series_creative_title: "The Creative Career", cms_series_creative_epcount: "7 Episodes", cms_series_creative_category: "arts", cms_series_creative_youtube: "", cms_series_creative_percentage: "14%",
  cms_series_finance_title: "Corporate & Finance", cms_series_finance_epcount: "5 Episodes", cms_series_finance_category: "finance", cms_series_finance_youtube: "", cms_series_finance_percentage: "0%",
  // Spotlight / This Week's Guest CMS
  cms_spotlight_mentor_id: "",  // MongoDB _id of the Mentor to feature as "This Week's Guest"
  // Resources Page Hero & Stats
  cms_resources_hero_eyebrow: "Resource Library",
  cms_resources_hero_title: "Everything You Need to<br/>Build Your Career",
  cms_resources_hero_subtitle: "Episode PDFs, career guides, templates, reading lists, salary reports and more — all free, all curated from our guest experts across every field.",
  cms_resources_stat_resources_num: "48",
  cms_resources_stat_resources_lbl: "Resources",
  cms_resources_stat_pdfs_num: "28",
  cms_resources_stat_pdfs_lbl: "Episode PDFs",
  cms_resources_stat_fields_num: "8",
  cms_resources_stat_fields_lbl: "Career Fields",
  cms_resources_stat_templates_num: "12",
  cms_resources_stat_templates_lbl: "Templates",
  // Resources Page Types Explainer & Coming Soon
  cms_resources_types_kicker: "What's Inside",
  cms_resources_types_title: "8 Types of Resources,<br/>All Free to Download",
  cms_resources_type_pdf_desc: "Key takeaways, guest quotes, action items and reflection prompts for every episode.",
  cms_resources_type_guide_desc: "Step-by-step roadmaps to break into each field — qualifications, timelines, first steps.",
  cms_resources_type_template_desc: "Field-specific CV/resume templates, cover letter frameworks, and LinkedIn bio builders.",
  cms_resources_type_worksheet_desc: "Goal-setting workbooks, self-assessment guides, and quarterly reflection journals.",
  cms_resources_type_reading_desc: "Curated books, podcasts, and courses recommended directly by our guest experts.",
  cms_resources_type_toolkit_desc: "Interview prep kits, skill checklists, and everything you need to land your first role.",
  cms_resources_type_salary_desc: "Real earnings data across industries — so you know your worth before any negotiation.",
  cms_resources_type_script_desc: "Networking email templates, LinkedIn outreach scripts, and mentorship request messages.",
  cms_resources_coming_kicker: "🔒 Coming Soon",
  cms_resources_coming_title: "Resources in the Pipeline",
  cms_resources_coming_subtitle: "Notify me when they drop."
};

const seedCmsDefaults = async () => {
  try {
    for (const [key, value] of Object.entries(cmsDefaults)) {
      const existing = await Option.findOne({ key });
      if (!existing) {
        await Option.create({ key, value });
      }
    }
    console.log('CMS default options seeded/verified successfully.');
  } catch (err) {
    console.error('Error seeding CMS default options:', err);
  }
};

/* ====================================================================
   DATABASE CONNECTION & SERVER LISTEN
   ==================================================================== */

// Keep-alive self-pinging to prevent Render server sleep
function startSelfPing() {
  const https = require('https');
  const SELF_PING_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const HOST_URL = process.env.RENDER_EXTERNAL_URL || 'https://bnb-girl-backend.onrender.com';
  const PING_URL = `${HOST_URL}/api/health`;

  console.log(`[Self-Ping] Initialized keep-alive job. URL: ${PING_URL}, Interval: 5 mins`);

  setInterval(() => {
    https.get(PING_URL, (res) => {
      console.log(`[Self-Ping] Sent GET request to Keep-Alive. Status Code: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error(`[Self-Ping] Error sending request:`, err.message);
    });
  }, SELF_PING_INTERVAL);
}

console.log('Connecting to MongoDB database...');
mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected successfully!');

    // Clean up null-valued fields and drop old unique indexes so Mongoose can rebuild them as sparse
    try {
      const db = mongoose.connection.db;
      const usersCollection = db.collection('users');

      // Unset null values to prevent duplicate key constraint violations
      await usersCollection.updateMany({ username: null }, { $unset: { username: "" } });
      await usersCollection.updateMany({ firebaseUid: null }, { $unset: { firebaseUid: "" } });
      await usersCollection.updateMany({ email: null }, { $unset: { email: "" } });

      // Drop indexes (if they exist) so Mongoose can recreate them with the sparse: true option
      await usersCollection.dropIndex('username_1').catch(() => { });
      await usersCollection.dropIndex('firebaseUid_1').catch(() => { });

      console.log('Successfully cleaned up null indexes in MongoDB users collection.');
    } catch (indexErr) {
      console.error('Error during index configuration cleanup:', indexErr.message);
    }

    seedCmsDefaults();
    app.listen(PORT, () => {
      console.log(`BBG Backend Server running on port ${PORT}`);
      console.log(`API root available at: http://localhost:${PORT}/api`);
      startSelfPing();
    });
  })
  .catch(err => {
    console.error('Database connection failed:', err);
    process.exit(1);
  });
