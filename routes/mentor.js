const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const Mentor = require('../models/Mentor');
const Submission = require('../models/Submission');
const mentorAuth = require('../middleware/mentorAuth');

// Helper to convert a local date and time in a specific timezone to a UTC Date object
function getUtcTime(dateStr, timeStr, timezone) {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hour, minute] = timeStr.split(':').map(Number);
    
    // Create UTC base date
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
    
    // Check timezone offset dynamically by formatting using Intl
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    });
    
    const parts = formatter.formatToParts(date);
    const map = {};
    parts.forEach(p => map[p.type] = p.value);
    
    // Intl hour can return 24 for midnight in some Node versions, normalize it
    let localHr = parseInt(map.hour, 10);
    if (localHr === 24) localHr = 0;
    
    const localDate = new Date(Date.UTC(
      parseInt(map.year, 10),
      parseInt(map.month, 10) - 1,
      parseInt(map.day, 10),
      localHr,
      parseInt(map.minute, 10)
    ));
    
    const diffMs = localDate.getTime() - date.getTime();
    return new Date(date.getTime() - diffMs);
  } catch (err) {
    console.error(`[Timezone Error] failed to calculate UTC time for ${dateStr} ${timeStr} in ${timezone}:`, err);
    // Fallback to naive Date construction
    return new Date(`${dateStr}T${timeStr}:00Z`);
  }
}

// Helper to format a UTC Date object into a readable local date and time string in a specific timezone
function getLocalTimeParts(dateObj, timezone) {
  try {
    const date = typeof dateObj === 'string' ? new Date(dateObj) : dateObj;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(date);
    const map = {};
    parts.forEach(p => map[p.type] = p.value);
    
    // Format date as YYYY-MM-DD
    const localDate = `${map.year}-${map.month}-${map.day}`;
    // Format time as HH:MM
    const localTime = `${map.hour}:${map.minute}`;
    
    return { date: localDate, time: localTime };
  } catch (err) {
    console.error(`[Timezone Error] failed to format local time for ${dateObj} in ${timezone}:`, err);
    return { date: '', time: '' };
  }
}

// Helper to send emails using nodemailer/SMTP
const sendEmail = async ({ to, subject, text, html, attachments }) => {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT || '587');

  if (!smtpUser || !smtpPass) {
    console.warn(`WARNING: SMTP credentials not configured. Skipping mail to ${to}`);
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

    await transporter.sendMail({
      from: `"Bold & Brilliant Girls" <${smtpUser}>`,
      to,
      subject,
      text,
      html,
      attachments
    });
    console.log(`[SMTP Email Sent] to ${to}`);
    return { success: true };
  } catch (err) {
    console.error(`[SMTP Email Error] Failed to send email to ${to}:`, err);
    return { success: false, error: err.message };
  }
};

// Generate standard .ics calendar invite string for updates
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
    'SEQUENCE:1',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

// POST /api/mentor/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const mentor = await Mentor.findOne({ email });
    if (!mentor) {
      return res.status(400).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await mentor.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: mentor._id, email: mentor.email, role: 'mentor' },
      process.env.JWT_SECRET || 'supersecretjwtkeyforbbgplatform123!',
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      mentor: {
        id: mentor._id,
        name: mentor.name,
        email: mentor.email,
        role: mentor.role,
        photo: mentor.photo,
        bio: mentor.bio,
        quote: mentor.quote,
        linkedin: mentor.linkedin,
        expertise_areas: mentor.expertise_areas,
        rate: mentor.rate,
        durs: mentor.durs,
        slots: mentor.slots,
        busy: mentor.busy,
        pricing: mentor.pricing
      }
    });
  } catch (err) {
    console.error('Mentor login error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /api/mentor/google-login
router.post('/google-login', async (req, res) => {
  try {
    const { idToken, email } = req.body;
    if (!idToken) {
      return res.status(400).json({ success: false, message: 'ID token is required' });
    }

    let verifiedEmail = email ? email.trim().toLowerCase() : '';
    let firebaseUid = '';

    // Handle developer / mock token bypass
    if (idToken === 'mock_firebase_token') {
      if (!verifiedEmail) {
        return res.status(400).json({ success: false, message: 'Email required for mock firebase login' });
      }
      firebaseUid = `mock_uid_${verifiedEmail.replace(/[^a-zA-Z0-9]/g, '')}`;
    } else {
      // Verify using Google Identity Toolkit
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
      firebaseUid = firebaseUser.localId;
    }

    // Find if the mentor is already registered in DB
    const mentor = await Mentor.findOne({ email: verifiedEmail });
    if (!mentor) {
      // Do not create a new account!
      return res.status(400).json({ success: false, message: 'You are not a registered mentor. Please apply or contact admin.' });
    }

    // Sign JWT
    const token = jwt.sign(
      { id: mentor._id, email: mentor.email, role: 'mentor' },
      process.env.JWT_SECRET || 'supersecretjwtkeyforbbgplatform123!',
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      mentor: {
        id: mentor._id,
        name: mentor.name,
        email: mentor.email,
        role: mentor.role,
        photo: mentor.photo,
        bio: mentor.bio,
        quote: mentor.quote,
        linkedin: mentor.linkedin,
        expertise_areas: mentor.expertise_areas,
        rate: mentor.rate,
        durs: mentor.durs,
        slots: mentor.slots,
        busy: mentor.busy,
        pricing: mentor.pricing
      }
    });
  } catch (err) {
    console.error('Mentor google login error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/mentor/profile (Protected)
router.get('/profile', mentorAuth, async (req, res) => {
  try {
    const mentor = await Mentor.findById(req.mentor.id).select('-password');
    if (!mentor) {
      return res.status(404).json({ success: false, message: 'Mentor profile not found' });
    }
    res.json({ success: true, mentor });
  } catch (err) {
    console.error('Fetch mentor profile error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// PUT /api/mentor/profile (Protected)
router.put('/profile', mentorAuth, async (req, res) => {
  try {
    const { bio, quote, rate, slots, busy, pricing, photo, role, linkedin, expertise_areas, durs, password, meeting_link } = req.body;
    
    const mentor = await Mentor.findById(req.mentor.id);
    if (!mentor) {
      return res.status(404).json({ success: false, message: 'Mentor not found' });
    }

    if (bio !== undefined) mentor.bio = bio;
    if (quote !== undefined) mentor.quote = quote;
    if (rate !== undefined) mentor.rate = rate;
    if (slots !== undefined) mentor.slots = slots;
    if (busy !== undefined) mentor.busy = busy;
    if (pricing !== undefined) mentor.pricing = pricing;
    if (photo !== undefined) mentor.photo = photo;
    if (role !== undefined) mentor.role = role;
    if (linkedin !== undefined) mentor.linkedin = linkedin;
    if (expertise_areas !== undefined) {
      mentor.expertise_areas = Array.isArray(expertise_areas)
        ? expertise_areas.join(', ')
        : expertise_areas;
    }
    if (durs !== undefined) mentor.durs = durs;
    if (meeting_link !== undefined) mentor.meeting_link = meeting_link;

    if (password) {
      mentor.password = password;
    }

    await mentor.save();

    if (req.app && typeof req.app.get('clearMentorsCache') === 'function') {
      req.app.get('clearMentorsCache')();
    }

    const updatedMentor = mentor.toObject();
    delete updatedMentor.password;

    res.json({ success: true, mentor: updatedMentor });
  } catch (err) {
    console.error('Update mentor profile error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/mentor/bookings (Protected)
router.get('/bookings', mentorAuth, async (req, res) => {
  try {
    const bookings = await Submission.find({
      form_type: 'mentorship',
      $or: [
        { 'data.mentor_id': req.mentor.id },
        { 'data.mentor_id': String(req.mentor.id) }
      ]
    }).sort({ created_at: -1 });

    res.json({ success: true, bookings });
  } catch (err) {
    console.error('Fetch mentor bookings error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// PUT /api/mentor/bookings/:id/reschedule-accept - Mentor accepts reschedule
router.put('/bookings/:id/reschedule-accept', mentorAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Submission.findById(id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    // Security check: Verify mentor
    if (String(booking.data.mentor_id) !== String(req.mentor.id)) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to this booking.' });
    }

    if (!booking.data.reschedule_request || booking.data.reschedule_request.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'No pending reschedule request found.' });
    }

    const newDate = booking.data.reschedule_request.date;
    const newTime = booking.data.reschedule_request.time;

    const dbMentor = await Mentor.findById(req.mentor.id);
    const studentTz = booking.data.student_tz || 'Asia/Kolkata';
    const utcStart = getUtcTime(newDate, newTime, studentTz);
    const durationMinutes = parseInt(booking.data.duration, 10) || 30;
    const utcEnd = new Date(utcStart.getTime() + durationMinutes * 60 * 1000);

    // Update main schedule date and time
    booking.data.date = newDate;
    booking.data.time = newTime;
    booking.data.utc_start = utcStart.toISOString();
    booking.data.utc_end = utcEnd.toISOString();
    booking.data.reschedule_request.status = 'accepted';
    
    booking.markModified('data');
    await booking.save();

    // Trigger updated confirmation emails with the new calendar invite using UTC dates
    const startTime = new Date(booking.data.utc_start);
    const endTime = new Date(booking.data.utc_end);
    const meetLink = booking.data.meet_link || 'https://meet.google.com';

    const icsContent = generateIcsFile({
      start: startTime,
      end: endTime,
      summary: `UPDATED: Mentorship Session: ${booking.data.mentor} & Student`,
      description: `Your mentorship session has been rescheduled.\nGoogle Meet Link: ${meetLink}`,
      location: meetLink
    });

    const inviteAttachment = {
      filename: 'invite.ics',
      content: icsContent,
      contentType: 'text/calendar; charset=utf-8; method=REQUEST'
    };

    // Format local times
    const mentorTz = dbMentor?.timezone || 'America/New_York';
    const mentorTime = getLocalTimeParts(startTime, mentorTz);

    // Notify Student
    const studentHtml = `
      <div style="font-family: sans-serif; padding: 25px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        <h2 style="color: #EC4899; text-align: center;">Mentorship Rescheduled (Confirmed)</h2>
        <p>Hi there,</p>
        <p>Your request to reschedule the mentorship session with <strong>${booking.data.mentor}</strong> was approved by the mentor.</p>
        
        <div style="background-color: #fdf2f8; border-left: 4px solid #EC4899; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
          <p style="margin: 0; font-weight: bold; color: #9d174d;">Updated Details:</p>
          <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #9d174d; line-height: 1.6;">
            <li><strong>Mentor:</strong> ${booking.data.mentor}</li>
            <li><strong>New Date:</strong> ${newDate}</li>
            <li><strong>New Time:</strong> ${newTime} (${studentTz})</li>
            <li><strong>Google Meet Link:</strong> <a href="${meetLink}" style="color: #be185d; font-weight: bold;">Join Google Meet</a></li>
          </ul>
        </div>
        <p>We've attached an updated calendar invite (<code>invite.ics</code>) to this email. You can open it to update your calendar.</p>
      </div>
    `;

    if (booking.data.email) {
      await sendEmail({
        to: booking.data.email,
        subject: `UPDATED: Mentorship Session with ${booking.data.mentor}`,
        text: `Hi there,\n\nYour mentorship session with ${booking.data.mentor} has been rescheduled to ${newDate} at ${newTime} (${studentTz}).\nGoogle Meet: ${meetLink}`,
        html: studentHtml,
        attachments: [inviteAttachment]
      });
    }

    // Notify Mentor
    const mentorEmail = req.mentor.email;
    const mentorHtml = `
      <div style="font-family: sans-serif; padding: 25px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        <h2 style="color: #6C5DD3; text-align: center;">Reschedule Confirmed</h2>
        <p>Hello ${booking.data.mentor},</p>
        <p>You have approved the reschedule request for your session with <strong>${booking.data.email}</strong>.</p>
        
        <div style="background-color: #f8fafc; border-left: 4px solid #6C5DD3; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
          <p style="margin: 0; font-weight: bold; color: #4338ca;">New Schedule:</p>
          <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #4338ca; line-height: 1.6;">
            <li><strong>Student Email:</strong> ${booking.data.email}</li>
            <li><strong>New Date:</strong> ${mentorTime.date}</li>
            <li><strong>New Time:</strong> ${mentorTime.time} (${mentorTz})</li>
            <li><strong>Google Meet Link:</strong> <a href="${meetLink}" style="color: #4338ca; font-weight: bold;">Join Google Meet</a></li>
          </ul>
        </div>
        <p>We've attached an updated calendar invite (<code>invite.ics</code>). Please open it to sync your calendar.</p>
      </div>
    `;

    if (mentorEmail) {
      await sendEmail({
        to: mentorEmail,
        subject: `Reschedule Confirmed: Mentorship with ${booking.data.email}`,
        text: `Hello ${booking.data.mentor},\n\nYou rescheduled your session with ${booking.data.email} to ${mentorTime.date} at ${mentorTime.time} (${mentorTz}).\nGoogle Meet: ${meetLink}`,
        html: mentorHtml,
        attachments: [inviteAttachment]
      });
    }

    res.json({ success: true, booking });
  } catch (err) {
    console.error('Error accepting reschedule request:', err);
    res.status(500).json({ success: false, message: 'Server error accepting request.', error: err.message });
  }
});

// PUT /api/mentor/bookings/:id/reschedule-decline - Mentor declines reschedule
router.put('/bookings/:id/reschedule-decline', mentorAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Submission.findById(id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    // Security check: Verify mentor
    if (String(booking.data.mentor_id) !== String(req.mentor.id)) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to this booking.' });
    }

    if (!booking.data.reschedule_request || booking.data.reschedule_request.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'No pending reschedule request found.' });
    }

    // Decline request
    booking.data.reschedule_request.status = 'rejected';
    booking.markModified('data');
    await booking.save();

    // Send notification to student
    const studentHtml = `
      <div style="font-family: sans-serif; padding: 25px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        <h2 style="color: #ef4444; text-align: center;">Reschedule Request Declined</h2>
        <p>Hi there,</p>
        <p>Your request to reschedule the mentorship session with <strong>${booking.data.mentor}</strong> was declined because of conflicts in the mentor's schedule.</p>
        
        <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
          <p style="margin: 0; font-weight: bold; color: #991b1b;">Original Schedule Remains Active:</p>
          <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #991b1b; line-height: 1.6;">
            <li><strong>Mentor:</strong> ${booking.data.mentor}</li>
            <li><strong>Date:</strong> ${booking.data.date}</li>
            <li><strong>Time:</strong> ${booking.data.time}</li>
            <li><strong>Google Meet Link:</strong> <a href="${booking.data.meet_link || 'https://meet.google.com'}" style="color: #991b1b; font-weight: bold;">Join Google Meet</a></li>
          </ul>
        </div>
        <p>If you need to select another date, please log in to your dashboard and submit a new request with a different slot.</p>
      </div>
    `;

    if (booking.data.email) {
      await sendEmail({
        to: booking.data.email,
        subject: `Update: Reschedule Request Declined for Mentorship with ${booking.data.mentor}`,
        text: `Hi there,\n\nYour reschedule request was declined. Your mentorship session with ${booking.data.mentor} remains scheduled for ${booking.data.date} at ${booking.data.time}.`,
        html: studentHtml
      });
    }

    res.json({ success: true, booking });
  } catch (err) {
    console.error('Error declining reschedule request:', err);
    res.status(500).json({ success: false, message: 'Server error declining request.', error: err.message });
  }
});

// PUT /api/mentor/bookings/:id/reschedule - Mentor reschedules a booking directly
router.put('/bookings/:id/reschedule', mentorAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { date, time } = req.body;

    if (!date || !time) {
      return res.status(400).json({ success: false, message: 'Date and time are required for rescheduling.' });
    }

    const booking = await Submission.findById(id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    // Security check: Verify mentor
    if (String(booking.data.mentor_id) !== String(req.mentor.id)) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to this booking.' });
    }

    const dbMentor = await Mentor.findById(req.mentor.id);
    if (!dbMentor) {
      return res.status(404).json({ success: false, message: 'Mentor profile not found.' });
    }

    const mentorTz = dbMentor.timezone || 'America/New_York';
    const utcStart = getUtcTime(date, time, mentorTz);
    const duration = parseInt(booking.data.duration, 10) || 30;
    const utcEnd = new Date(utcStart.getTime() + duration * 60 * 1000);

    // Overlap validation in UTC
    const otherBookings = await Submission.find({
      _id: { $ne: booking._id },
      form_type: 'mentorship',
      status: { $ne: 'spam' },
      $or: [
        { 'data.mentor_id': req.mentor.id },
        { 'data.mentor_id': String(req.mentor.id) }
      ]
    });

    const getBookingUtcRange = (b) => {
      if (b.data.utc_start) {
        return {
          start: new Date(b.data.utc_start),
          end: new Date(b.data.utc_end)
        };
      }
      const start = new Date(`${b.data.date}T${b.data.time}:00Z`);
      const durationVal = parseInt(b.data.duration, 10) || 30;
      return {
        start,
        end: new Date(start.getTime() + durationVal * 60 * 1000)
      };
    };

    const hasOverlap = otherBookings.some(b => {
      const bRange = getBookingUtcRange(b);
      return (utcStart < bRange.end && utcEnd > bRange.start);
    });

    if (hasOverlap) {
      return res.status(400).json({ success: false, message: 'The requested time slot overlaps with another booking. Please select another slot.' });
    }

    // Check if slot falls in mentor's busy blocks
    if (dbMentor.busy && dbMentor.busy.includes(time)) {
      return res.status(400).json({ success: false, message: 'This slot is marked as busy in your profile settings.' });
    }

    // Convert new reschedule time to Student's local timezone parts
    const studentTz = booking.data.student_tz || 'Asia/Kolkata';
    const studentTime = getLocalTimeParts(utcStart, studentTz);

    // Update main schedule date and time
    booking.data.date = studentTime.date;
    booking.data.time = studentTime.time;
    booking.data.utc_start = utcStart.toISOString();
    booking.data.utc_end = utcEnd.toISOString();
    booking.data.reschedule_request = {
      date: studentTime.date,
      time: studentTime.time,
      status: 'accepted',
      rescheduled_by: 'mentor',
      rescheduled_at: new Date().toISOString()
    };
    
    booking.markModified('data');
    await booking.save();

    // Trigger updated confirmation emails with the new calendar invite using UTC dates
    const startTime = new Date(booking.data.utc_start);
    const endTime = new Date(booking.data.utc_end);
    const meetLink = booking.data.meet_link || 'https://meet.google.com';

    const icsContent = generateIcsFile({
      start: startTime,
      end: endTime,
      summary: `UPDATED: Mentorship Session: ${booking.data.mentor} & Student`,
      description: `Your mentorship session has been rescheduled by the mentor.\nGoogle Meet Link: ${meetLink}`,
      location: meetLink
    });

    const inviteAttachment = {
      filename: 'invite.ics',
      content: icsContent,
      contentType: 'text/calendar; charset=utf-8; method=REQUEST'
    };

    // Notify Student
    const studentHtml = `
      <div style="font-family: sans-serif; padding: 25px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        <h2 style="color: #EC4899; text-align: center;">Mentorship Session Rescheduled</h2>
        <p>Hi there,</p>
        <p>Your mentor <strong>${booking.data.mentor}</strong> has rescheduled your upcoming mentorship session.</p>
        
        <div style="background-color: #fdf2f8; border-left: 4px solid #EC4899; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
          <p style="margin: 0; font-weight: bold; color: #9d174d;">New Details:</p>
          <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #9d174d; line-height: 1.6;">
            <li><strong>Mentor:</strong> ${booking.data.mentor}</li>
            <li><strong>New Date:</strong> ${studentTime.date}</li>
            <li><strong>New Time:</strong> ${studentTime.time} (${studentTz})</li>
            <li><strong>Google Meet Link:</strong> <a href="${meetLink}" style="color: #be185d; font-weight: bold;">Join Google Meet</a></li>
          </ul>
        </div>
        <p>We've attached an updated calendar invite (<code>invite.ics</code>) to this email. You can open it to update your calendar.</p>
      </div>
    `;

    if (booking.data.email) {
      await sendEmail({
        to: booking.data.email,
        subject: `UPDATED: Mentorship Session with ${booking.data.mentor}`,
        text: `Hi there,\n\nYour mentorship session with ${booking.data.mentor} has been rescheduled by the mentor to ${studentTime.date} at ${studentTime.time} (${studentTz}).\nGoogle Meet: ${meetLink}`,
        html: studentHtml,
        attachments: [inviteAttachment]
      });
    }

    // Notify Mentor
    const mentorEmail = req.mentor.email;
    const mentorHtml = `
      <div style="font-family: sans-serif; padding: 25px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        <h2 style="color: #6C5DD3; text-align: center;">Reschedule Confirmed</h2>
        <p>Hello ${booking.data.mentor},</p>
        <p>You have rescheduled your session with <strong>${booking.data.email}</strong>.</p>
        
        <div style="background-color: #f8fafc; border-left: 4px solid #6C5DD3; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
          <p style="margin: 0; font-weight: bold; color: #4338ca;">New Schedule Details:</p>
          <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #4338ca; line-height: 1.6;">
            <li><strong>Student Email:</strong> ${booking.data.email}</li>
            <li><strong>New Date:</strong> ${date}</li>
            <li><strong>New Time:</strong> ${time} (${mentorTz})</li>
            <li><strong>Google Meet Link:</strong> <a href="${meetLink}" style="color: #4338ca; font-weight: bold;">Join Google Meet</a></li>
          </ul>
        </div>
        <p>We've attached an updated calendar invite (<code>invite.ics</code>) for your records.</p>
      </div>
    `;

    if (mentorEmail) {
      await sendEmail({
        to: mentorEmail,
        subject: `Reschedule Confirmed: Mentorship with ${booking.data.email}`,
        text: `Hello ${booking.data.mentor},\n\nYou rescheduled your session with ${booking.data.email} to ${date} at ${time} (${mentorTz}).\nGoogle Meet: ${meetLink}`,
        html: mentorHtml,
        attachments: [inviteAttachment]
      });
    }

    res.json({ success: true, booking });
  } catch (err) {
    console.error('Error rescheduling booking:', err);
    res.status(500).json({ success: false, message: 'Server error rescheduling session.', error: err.message });
  }
});

module.exports = router;
