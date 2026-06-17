const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const Mentor = require('../models/Mentor');
const Submission = require('../models/Submission');
const mentorAuth = require('../middleware/mentorAuth');

// Helper to send emails using nodemailer/SMTP
const sendEmail = async ({ to, subject, text, html, attachments }) => {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT || '587');

  if (!smtpUser || !smtpPass) {
    console.warn(`WARNING: SMTP credentials not configured. Skipping mail to ${to}`);
    return;
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
    console.log(`[Reschedule Email Sent] to ${to}`);
  } catch (err) {
    console.error(`[Reschedule Email Error] Failed to send email to ${to}:`, err);
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
    const { bio, quote, rate, slots, busy, pricing, photo, role, linkedin, expertise_areas, durs } = req.body;
    const updateFields = {};

    if (bio !== undefined) updateFields.bio = bio;
    if (quote !== undefined) updateFields.quote = quote;
    if (rate !== undefined) updateFields.rate = rate;
    if (slots !== undefined) updateFields.slots = slots;
    if (busy !== undefined) updateFields.busy = busy;
    if (pricing !== undefined) updateFields.pricing = pricing;
    if (photo !== undefined) updateFields.photo = photo;
    if (role !== undefined) updateFields.role = role;
    if (linkedin !== undefined) updateFields.linkedin = linkedin;
    if (expertise_areas !== undefined) updateFields.expertise_areas = expertise_areas;
    if (durs !== undefined) updateFields.durs = durs;

    const mentor = await Mentor.findByIdAndUpdate(
      req.mentor.id,
      { $set: updateFields },
      { new: true }
    ).select('-password');

    res.json({ success: true, mentor });
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

    // Update main schedule date and time
    booking.data.date = newDate;
    booking.data.time = newTime;
    booking.data.reschedule_request.status = 'accepted';
    
    booking.markModified('data');
    await booking.save();

    // Trigger updated confirmation emails with the new calendar invite
    const dateParts = newDate.split('-');
    const timeParts = newTime.split(':');
    const startTime = new Date(
      parseInt(dateParts[0]),
      parseInt(dateParts[1]) - 1,
      parseInt(dateParts[2]),
      parseInt(timeParts[0]),
      parseInt(timeParts[1]),
      0
    );
    const durationMinutes = parseInt(booking.data.duration) || 30;
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
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
            <li><strong>New Time:</strong> ${newTime}</li>
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
        text: `Hi there,\n\nYour mentorship session with ${booking.data.mentor} has been rescheduled to ${newDate} at ${newTime}.\nGoogle Meet: ${meetLink}`,
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
            <li><strong>New Date:</strong> ${newDate}</li>
            <li><strong>New Time:</strong> ${newTime}</li>
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
        text: `Hello ${booking.data.mentor},\n\nYou rescheduled your session with ${booking.data.email} to ${newDate} at ${newTime}.\nGoogle Meet: ${meetLink}`,
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

module.exports = router;
