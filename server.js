const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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

// Load Auth Middleware
const auth = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 5002;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bbg-platform';

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Middlewares
app.use(cors());
app.use(express.json());
// Serve uploads folder as static files
app.use('/uploads', express.static(uploadsDir));

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
    // 1. Episode guests who are mentors
    const epMentors = await Episode.find({ is_mentor: true, status: 'published' })
      .populate('category_id')
      .sort({ is_featured: -1, created_at: -1 })
      .lean();

    const formattedEp = epMentors.map(e => ({
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
      source: 'episode'
    }));

    // 2. Dedicated mentors
    const dedicated = await Mentor.find({ status: 'published' })
      .populate('category_id')
      .populate('episode_id')
      .sort({ is_featured: -1, created_at: -1 })
      .lean();

    const formattedDedicated = dedicated.map(m => ({
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
      episode_id: m.episode_id ? m.episode_id._id : null
    }));

    // Combine lists
    res.json([...formattedEp, ...formattedDedicated]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching mentors' });
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

// 8. POST /api/forms - Submission receiver mapping
const submitForm = async (formType, req, res) => {
  try {
    const data = req.body;
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
    if (emailOpt?.value === '1' && notifyEmail?.value) {
      console.log(`[Email Notification Sent to ${notifyEmail.value}] New submission for ${formType}`);
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

// GET /api/cms - Public CMS content endpoint
app.get('/api/cms', async (req, res) => {
  try {
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
app.post('/api/admin/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ success: true, url: fileUrl, filename: req.file.filename });
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
    res.setHeader('Content-Disposition', `attachment; filename=bbg-export-${form || 'all'}-${new Date().toISOString().slice(0,10)}.csv`);

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
  cms_about_contact_email: "sanah@bnbgirl.com"
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

console.log('Connecting to MongoDB database...');
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected successfully!');
    seedCmsDefaults();
    app.listen(PORT, () => {
      console.log(`BBG Backend Server running on port ${PORT}`);
      console.log(`API root available at: http://localhost:${PORT}/api`);
    });
  })
  .catch(err => {
    console.error('Database connection failed:', err);
    process.exit(1);
  });
