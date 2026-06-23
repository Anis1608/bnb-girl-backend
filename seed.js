const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

// Load Models
const User = require('./models/User');
const Option = require('./models/Option');
const Category = require('./models/Category');
const Subcategory = require('./models/Subcategory');
const SpecializedField = require('./models/SpecializedField');
const Episode = require('./models/Episode');
const Resource = require('./models/Resource');
const Mentor = require('./models/Mentor');
const Submission = require('./models/Submission');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bbg-platform';

async function seed() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected!');

    // 1. Clear existing data
    console.log('Clearing existing collections...');
    await User.deleteMany({});
    await Option.deleteMany({});
    await Category.deleteMany({});
    await Subcategory.deleteMany({});
    await SpecializedField.deleteMany({});
    await Episode.deleteMany({});
    await Resource.deleteMany({});
    await Mentor.deleteMany({});
    await Submission.deleteMany({ form_type: 'mentorship' });
    console.log('Cleared!');

    // 2. Seed Default Admin User
    console.log('Seeding default Admin...');
    const adminEmail = process.env.ADMIN_EMAIL || 'sanah@bnbgirl.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'sanah123';
    const adminUser = new User({
      username: adminEmail,
      password: adminPassword,
      role: 'admin'
    });
    await adminUser.save();
    console.log(`Admin seeded! (Username: ${adminEmail}, Password: ${adminPassword})`);

    // 3. Seed Default Options
    console.log('Seeding options...');
    const options = {
      'bbg_email': 'sanah@bnbgirl.com',
      'bbg_email_on_submit': '1',
      'bbg_quiz_gate': '1',
      'bbg_stat_episodes': '5',
      'bbg_stat_mentors': '10',
      'bbg_stat_community': '50',
      'bbg_stat_downloads': '100',
      'bbg_stat_countries': '18',
      'bbg_stat_response': '5',
      'bbg_stat_industries': '12',
      'bbg_stat_views': '100',
      'bbg_stat_views_unit': 'M+',
    };

    for (const [key, value] of Object.entries(options)) {
      await Option.create({ key, value });
    }
    console.log('Options seeded!');

    // 4. Load & Seed Taxonomy JSON
    console.log('Loading taxonomy.json...');
    const taxonomyPath = path.join(__dirname, 'taxonomy.json');
    if (!fs.existsSync(taxonomyPath)) {
      throw new Error('taxonomy.json not found! Run generate_taxonomy_json.py first.');
    }
    const taxonomyData = JSON.parse(fs.readFileSync(taxonomyPath, 'utf8'));

    const categoryMap = {}; // slug -> ObjectId
    const subcategoryMap = {}; // catSlug_subSlug -> ObjectId
    const specializedFieldMap = {}; // catSlug_subSlug_sfSlug -> ObjectId

    console.log('Seeding categories, subcategories, and specialized fields...');
    for (let i = 0; i < taxonomyData.length; i++) {
      const cat = taxonomyData[i];
      const category = await Category.create({
        name: cat.name,
        slug: cat.slug,
        color: cat.color,
        icon: cat.icon,
        description: cat.description,
        sort_order: i
      });
      categoryMap[cat.slug] = category._id;

      for (let j = 0; j < cat.subcategories.length; j++) {
        const sub = cat.subcategories[j];
        const subcategory = await Subcategory.create({
          category_id: category._id,
          name: sub.name,
          slug: sub.slug,
          sort_order: j
        });
        subcategoryMap[`${cat.slug}_${sub.slug}`] = subcategory._id;

        for (let k = 0; k < sub.level3.length; k++) {
          const l3 = sub.level3[k];
          const sf = await SpecializedField.create({
            subcategory_id: subcategory._id,
            name: l3.name,
            slug: l3.slug,
            sort_order: k
          });
          specializedFieldMap[`${cat.slug}_${sub.slug}_${l3.slug}`] = sf._id;
        }
      }
    }
    console.log('Taxonomy successfully seeded!');

    // 5. Seed Dummy Episodes
    console.log('Seeding dummy episodes...');
    const episodes = [
      {
        title: "Relearning the ABCs of Girls' Education",
        guest_name: 'Dr. Sheen Gurrib',
        guest_role: 'Podcaster & Entrepreneur · Oxford & Cambridge',
        guest_photo: 'https://placehold.co/64x64/9333EA/fff?text=SG',
        guest_bio: "Dr. Sheen Gurrib is the first girl from Mauritius to study at both Oxford and Cambridge. A multi-award winning podcaster, entrepreneur and advocate, she hosts Dream, Girl — a global platform supporting empowered women.",
        guest_quote: 'I want to play my part in supporting the next generation of empowered women.',
        episode_number: '01',
        catSlug: 'education-and-academia',
        subSlug: 'teaching',
        l3Slug: null,
        episode_type: 'Interview',
        youtube_id: 'yl-mqB1_1co',
        duration: '18 min',
        is_featured: true,
        is_new: true,
        is_mentor: true,
        mentor_rate: 'Free',
        mentor_avail: 'By appointment',
        mentor_linkedin: '',
        mentor_fields: 'Education, Girls Empowerment, Academic Mentorship',
        tags: 'education,girls,women,stem,oxford,cambridge,empowerment',
        description: "Dr. Sheen discusses how she overcame barriers to education and her mission to empower young women globally."
      },
      {
        title: 'Identity, Reinvention & Building Yourself From the Ground Up',
        guest_name: 'Maha Abouelenein',
        guest_role: 'Global Communications Strategist & Author',
        guest_photo: 'https://placehold.co/64x64/6B21A8/fff?text=MA',
        guest_bio: 'Maha Abouelenein is a globally recognised communications expert with 25+ years experience at Netflix, Google, and the Dubai government.',
        guest_quote: 'The bravest thing I ever did was choose myself over the version of me others needed me to be.',
        episode_number: '52',
        catSlug: 'business',
        subSlug: 'entrepreneurship',
        l3Slug: 'women-founders',
        episode_type: 'Interview',
        youtube_id: 'wFqMkA-BYIU',
        duration: '48 min',
        is_featured: false,
        is_new: true,
        is_mentor: true,
        mentor_rate: 'Paid',
        mentor_avail: 'Limited spots',
        mentor_linkedin: '',
        mentor_email: 'maha@bnbgirl.com',
        mentor_fields: 'Communications, Business Strategy, Branding',
        tags: 'leadership,business,branding,author,reinvention,identity',
        description: 'A deeply honest conversation about identity, ambition, and what it really takes to build yourself from the ground up.'
      },
      {
        title: 'Letting Go of Toxic Love, Standing in Your Worth & Ego Healing',
        guest_name: 'Dr Sara Al Madani',
        guest_role: 'Entrepreneur · Author · Public Figure',
        guest_photo: 'https://placehold.co/64x64/831843/fff?text=SA',
        guest_bio: 'Dr Sara Al Madani is a multi-award winning Emirati entrepreneur, author and television personality.',
        guest_quote: 'You cannot love someone into treating you right.',
        episode_number: '51',
        catSlug: 'healthcare',
        subSlug: 'mental-health',
        l3Slug: 'emotional-resilience',
        episode_type: 'Interview',
        youtube_id: 'D7Q9p5P4Ofo',
        duration: '54 min',
        is_featured: false,
        is_new: true,
        is_mentor: false,
        tags: 'wellness,self-love,toxic relationships,ego healing,worth',
        description: 'Raw, honest conversation about choosing yourself.'
      },
      {
        title: 'Avoiding Burnout & Listening to Your Inner Guide in the Digital Age',
        guest_name: 'Dr Saliha Afridi',
        guest_role: 'Clinical Psychologist',
        guest_photo: 'https://placehold.co/64x64/1E3A5F/fff?text=SA',
        guest_bio: 'Dr Saliha Afridi is one of the UAE\'s most trusted clinical psychologists. Founder of The LightHouse Arabia.',
        guest_quote: 'Rest is not a reward. Rest is the foundation.',
        episode_number: '50',
        catSlug: 'healthcare',
        subSlug: 'mental-health',
        l3Slug: 'burnout',
        episode_type: 'Solo',
        youtube_id: 'hBsZiXb9r8M',
        duration: '47 min',
        is_featured: false,
        is_new: false,
        is_mentor: true,
        mentor_rate: 'Paid consultation',
        mentor_avail: 'Monthly slots',
        mentor_linkedin: '',
        mentor_email: 'saliha@bnbgirl.com',
        mentor_fields: 'Burnout Prevention, Mental Wellness, Work-Life Balance',
        tags: 'burnout,mental health,psychology,digital wellness,inner guide',
        description: 'Clinical yet deeply human perspective on burnout.'
      },
      {
        title: 'Dual Cultural Identity, Authenticity & Making It in Media',
        guest_name: 'Mehreen',
        guest_role: 'Content Creator · Media Personality',
        guest_photo: 'https://placehold.co/64x64/4C1D95/fff?text=ME',
        guest_bio: 'Mehreen is a British-Pakistani content creator who has carved her own space in the digital media world.',
        guest_quote: 'I stopped trying to be a bridge and started being proud of being both.',
        episode_number: '49',
        catSlug: 'creative-and-media',
        subSlug: 'content-creation',
        l3Slug: 'instagram-growth',
        episode_type: 'Interview',
        youtube_id: 'D41xKKwNPDw',
        duration: '39 min',
        is_featured: false,
        is_new: false,
        is_mentor: false,
        tags: 'arts,media,identity,authenticity,cultural identity,representation',
        description: 'Finding your voice while navigating expectations of two cultures.'
      },
      {
        title: 'From Zero to Brand: The Real Journey of Building an Empire',
        guest_name: 'Amy Roko',
        guest_role: 'Founder · Brand Builder',
        guest_photo: 'https://placehold.co/64x64/92400E/fff?text=AR',
        guest_bio: 'Amy Roko built her brand empire from nothing but a laptop and relentless work ethic.',
        guest_quote: "I didn't wait until I was ready. I got ready by starting.",
        episode_number: '48',
        catSlug: 'business',
        subSlug: 'marketing',
        l3Slug: 'brand-strategy',
        episode_type: 'Interview',
        youtube_id: 'UlZts1AgYGE',
        duration: '43 min',
        is_featured: false,
        is_new: false,
        is_mentor: true,
        mentor_rate: 'Free intro session',
        mentor_avail: 'Bi-weekly',
        mentor_linkedin: '',
        mentor_email: 'amyroko@bnbgirl.com',
        mentor_fields: 'Branding, Entrepreneurship, Social Media',
        tags: 'business,branding,entrepreneurship,startup,founder',
        description: 'The real, unglamorous journey of building a brand from zero.'
      },
      {
        title: 'Navigating Your Soft Girl Era & Protecting Your Peace',
        guest_name: 'TheWizardLiz',
        guest_role: 'Mindset Coach · 5M+ Followers',
        guest_photo: 'https://placehold.co/64x64/1E1035/fff?text=TL',
        guest_bio: 'TheWizardLiz is a viral mindset creator with over 5 million followers across platforms.',
        guest_quote: 'Being soft is a choice for the strong.',
        episode_number: '47',
        catSlug: 'healthcare',
        subSlug: 'mental-health',
        l3Slug: 'anxiety',
        episode_type: 'Solo',
        youtube_id: 'q1I77BC0BeA',
        duration: '52 min',
        is_featured: false,
        is_new: false,
        is_mentor: false,
        tags: 'mindset,peace,boundaries,soft life,self-love',
        description: 'What the soft girl era really means and how to build unshakeable inner peace.'
      },
      {
        title: 'Building a Music Career on Your Own Terms',
        guest_name: 'Lamide Elizabeth',
        guest_role: 'Recording Artist · Songwriter',
        guest_photo: 'https://placehold.co/64x64/C2410C/fff?text=LE',
        guest_bio: 'Lamide Elizabeth is an independently signed recording artist navigating the music industry on her own terms.',
        guest_quote: "They told me to change my sound. I changed my team instead.",
        episode_number: '46',
        catSlug: 'creative-and-media',
        subSlug: 'music',
        l3Slug: null,
        episode_type: 'Interview',
        youtube_id: '2TENulPeqY0',
        duration: '36 min',
        is_featured: false,
        is_new: false,
        is_mentor: false,
        tags: 'music,arts,independence,creative career',
        description: 'Navigating the music industry while refusing to dilute your artistry.'
      },
      {
        title: 'Virality, Journalism & Building a Platform That Matters',
        guest_name: 'DJ Bliss',
        guest_role: 'DJ · Media Personality · Radio Host',
        guest_photo: 'https://placehold.co/64x64/0E7490/fff?text=DB',
        guest_bio: "DJ Bliss is one of the Middle East's most recognisable media personalities.",
        guest_quote: "Anyone can get attention. The skill is keeping it with something worth their time.",
        episode_number: '44',
        catSlug: 'creative-and-media',
        subSlug: 'content-creation',
        l3Slug: 'youtube-growth',
        episode_type: 'Interview',
        youtube_id: 'BBwiBAWBGVM',
        duration: '45 min',
        is_featured: false,
        is_new: false,
        is_mentor: false,
        tags: 'media,journalism,virality,platform building',
        description: 'Two decades of media wisdom on building a platform with integrity.'
      },
      {
        title: 'How to Build a Business That Survives Every Season of Your Life',
        guest_name: 'Jet Van Wijk',
        guest_role: 'Serial Entrepreneur · Investor',
        guest_photo: 'https://placehold.co/64x64/065F46/fff?text=JV',
        guest_bio: 'Jet Van Wijk is a South African serial entrepreneur and investor.',
        guest_quote: "Never confuse your business with your identity.",
        episode_number: '43',
        catSlug: 'business',
        subSlug: 'entrepreneurship',
        l3Slug: 'scaling-businesses',
        episode_type: 'Interview',
        youtube_id: '21xLnDWxgzI',
        duration: '38 min',
        is_featured: false,
        is_new: false,
        is_mentor: true,
        mentor_rate: 'Paid',
        mentor_avail: 'Quarterly intake',
        mentor_linkedin: '',
        mentor_fields: 'Investing, Serial Entrepreneurship',
        tags: 'entrepreneurship,business,resilience,investor',
        description: 'Framework for building businesses resilient across economic and personal seasons.'
      }
    ];

    for (const ep of episodes) {
      const catId = categoryMap[ep.catSlug] || null;
      const subId = subcategoryMap[`${ep.catSlug}_${ep.subSlug}`] || null;
      const sfId = ep.l3Slug ? (specializedFieldMap[`${ep.catSlug}_${ep.subSlug}_${ep.l3Slug}`] || null) : null;

      await Episode.create({
        title: ep.title,
        guest_name: ep.guest_name,
        guest_role: ep.guest_role,
        guest_photo: ep.guest_photo,
        guest_bio: ep.guest_bio,
        guest_quote: ep.guest_quote,
        episode_number: ep.episode_number,
        category_id: catId,
        subcategory_id: subId,
        specialized_field_id: sfId,
        episode_type: ep.episode_type,
        youtube_id: ep.youtube_id,
        spotify_url: ep.spotify_url,
        audio_url: ep.audio_url,
        duration: ep.duration,
        is_featured: ep.is_featured,
        is_new: ep.is_new,
        is_mentor: ep.is_mentor,
        mentor_rate: ep.mentor_rate || '',
        mentor_avail: ep.mentor_avail || '',
        mentor_linkedin: ep.mentor_linkedin || '',
        mentor_fields: ep.mentor_fields || '',
        tags: ep.tags,
        description: ep.description,
        status: 'published'
      });
    }
    console.log('Episodes seeded!');

      // 6. Seed Dummy Resources
    console.log('Seeding dummy resources...');
    const resources = [
      // 1. Women in STEM (mapped to technology & education-and-academia)
      {
        title: "Girls' Education Career Playbook — Dr. Sheen Gurrib",
        description: 'Key insights, action steps and reflection prompts from EP. 01 with Dr. Sheen Gurrib.',
        resource_type: 'pdf',
        catSlug: 'education-and-academia',
        subSlug: 'teaching',
        l3Slug: null,
        episode_ref: 'EP. 01',
        pages: 12,
        icon: '🎓',
        cover_color: 'linear-gradient(135deg,#3B0764,#7C3AED,#EC4899)',
        is_coming_soon: false,
        is_featured: true
      },
      {
        title: 'Women in Tech Interview Prep Kit',
        description: '50 interview questions, STAR templates and confidence frameworks from our STEM guests.',
        resource_type: 'toolkit',
        catSlug: 'technology',
        subSlug: 'software-engineering',
        l3Slug: null,
        episode_ref: 'STEM Series',
        pages: 18,
        icon: '💻',
        cover_color: 'linear-gradient(135deg,#022C22,#065F46,#34D399)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Breaking Into STEM — A Roadmap',
        description: 'Step-by-step guide to entering science, technology, engineering or maths careers from scratch.',
        resource_type: 'guide',
        catSlug: 'technology',
        subSlug: 'software-engineering',
        l3Slug: null,
        episode_ref: 'STEM Series',
        pages: 14,
        icon: '🔭',
        cover_color: 'linear-gradient(135deg,#0C4A6E,#0369A1,#38BDF8)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'STEM Graduate CV Template',
        description: 'ATS-friendly CV template designed for STEM graduates — with a guided example and tips.',
        resource_type: 'template',
        catSlug: 'technology',
        subSlug: 'software-engineering',
        l3Slug: null,
        episode_ref: 'All Episodes',
        pages: 4,
        icon: '📋',
        cover_color: 'linear-gradient(135deg,#1E1B4B,#4338CA,#818CF8)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'STEM Reading List — Recommended by Guests',
        description: 'Books, podcasts and online courses curated by every STEM guest who\'s appeared on BBG.',
        resource_type: 'reading',
        catSlug: 'technology',
        subSlug: 'software-engineering',
        l3Slug: null,
        episode_ref: 'All Episodes',
        pages: 8,
        icon: '📖',
        cover_color: 'linear-gradient(135deg,#134E4A,#0F766E,#2DD4BF)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Women in Tech Salary Report 2025',
        description: 'Real salary data for software, data, engineering and science roles across UK, US and India.',
        resource_type: 'salary',
        catSlug: 'technology',
        subSlug: 'software-engineering',
        l3Slug: null,
        episode_ref: 'Research',
        pages: 20,
        icon: '📊',
        cover_color: 'linear-gradient(135deg,#082F49,#0369A1,#38BDF8)',
        is_coming_soon: false,
        is_featured: true
      },

      // 2. Entrepreneurship & Business
      {
        title: "Side Hustle to Global Brand — EP. 02 Insights",
        description: 'Complete breakdown of Dr. Sheen\'s entrepreneurship episode: mindset shifts, key frameworks, and the 5 mistakes to avoid.',
        resource_type: 'pdf',
        catSlug: 'business',
        subSlug: 'entrepreneurship',
        l3Slug: 'women-founders',
        episode_ref: 'EP. 02',
        pages: 10,
        icon: '🚀',
        cover_color: 'linear-gradient(135deg,#451A03,#B45309,#F59E0B)',
        is_coming_soon: false,
        is_featured: true
      },
      {
        title: 'Starting From Zero — The Founder\'s Guide',
        description: 'A practical step-by-step framework for validating your business idea before quitting your day job.',
        resource_type: 'guide',
        catSlug: 'business',
        subSlug: 'entrepreneurship',
        l3Slug: 'first-time-founders',
        episode_ref: 'Business Series',
        pages: 16,
        icon: '💡',
        cover_color: 'linear-gradient(135deg,#78350F,#D97706,#FCD34D)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Pitch Deck Template for Women Founders',
        description: '10-slide investor pitch deck framework with a guided example, metrics guide, and storytelling tips.',
        resource_type: 'template',
        catSlug: 'business',
        subSlug: 'entrepreneurship',
        l3Slug: 'women-founders',
        episode_ref: 'Entrepreneurship Series',
        pages: 22,
        icon: '📊',
        cover_color: 'linear-gradient(135deg,#3F1505,#C2410C,#FB923C)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Business Model Canvas — Fillable Workbook',
        description: 'Interactive workbook version of the Business Model Canvas with reflection questions for each block.',
        resource_type: 'worksheet',
        catSlug: 'business',
        subSlug: 'entrepreneurship',
        l3Slug: null,
        episode_ref: 'Business Series',
        pages: 8,
        icon: '📓',
        cover_color: 'linear-gradient(135deg,#1C1917,#57534E,#D6D3D1)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Entrepreneur Reading List — Books That Changed Our Guests\' Lives',
        description: 'Books hand-picked by every entrepreneurial guest who has appeared on BBG — with a note on why each book mattered.',
        resource_type: 'reading',
        catSlug: 'business',
        subSlug: 'entrepreneurship',
        l3Slug: null,
        episode_ref: 'All Episodes',
        pages: 6,
        icon: '📚',
        cover_color: 'linear-gradient(135deg,#713F12,#CA8A04,#FEF08A)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'The BBG Leadership Toolkit',
        description: 'Self-assessment, values mapping, and communication style guide for aspiring leaders.',
        resource_type: 'toolkit',
        catSlug: 'business',
        subSlug: 'leadership',
        l3Slug: null,
        episode_ref: 'Leadership Series',
        pages: 14,
        icon: '🧰',
        cover_color: 'linear-gradient(135deg,#312E81,#4338CA,#818CF8)',
        is_coming_soon: false,
        is_featured: false
      },

      // 3. Law & Justice
      {
        title: 'How to Become a Lawyer — The Complete Guide',
        description: 'Law school applications, bar exam prep, and the different routes into practice across UK, US and India.',
        resource_type: 'guide',
        catSlug: 'law',
        subSlug: 'corporate-law',
        l3Slug: null,
        episode_ref: 'Law Series',
        pages: 18,
        icon: '⚖️',
        cover_color: 'linear-gradient(135deg,#1E1B4B,#3730A3,#6366F1)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Law School Personal Statement Template',
        description: 'A structured template with prompts and real examples to help you write a compelling law school application.',
        resource_type: 'template',
        catSlug: 'law',
        subSlug: 'corporate-law',
        l3Slug: null,
        episode_ref: 'Law Series',
        pages: 6,
        icon: '📝',
        cover_color: 'linear-gradient(135deg,#0D0B2A,#1E1B4B,#4338CA)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Legal Career Self-Assessment Workbook',
        description: 'Find which area of law suits your personality, strengths and values — with a guided 30-day action plan.',
        resource_type: 'worksheet',
        catSlug: 'law',
        subSlug: 'corporate-law',
        l3Slug: null,
        episode_ref: 'Law Series',
        pages: 10,
        icon: '📓',
        cover_color: 'linear-gradient(135deg,#2E1065,#6B21A8,#A855F7)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Law Reading List — Recommended by Guests',
        description: 'Essential law books, podcasts and documentaries curated by every legal professional who\'s appeared on BBG.',
        resource_type: 'reading',
        catSlug: 'law',
        subSlug: 'corporate-law',
        l3Slug: null,
        episode_ref: 'All Episodes',
        pages: 5,
        icon: '📚',
        cover_color: 'linear-gradient(135deg,#1E1B4B,#4338CA,#818CF8)',
        is_coming_soon: false,
        is_featured: false
      },

      // 4. Mental Health & Wellbeing
      {
        title: 'Mental Health & Career — EP. 03 Insights',
        description: 'Key insights on managing mental health while building a career, from our dedicated Mental Health & Career episode.',
        resource_type: 'pdf',
        catSlug: 'healthcare',
        subSlug: 'mental-health',
        l3Slug: 'emotional-resilience',
        episode_ref: 'EP. 03',
        pages: 9,
        icon: '🌸',
        cover_color: 'linear-gradient(135deg,#500724,#BE185D,#F472B6)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Burnout Self-Assessment & Recovery Workbook',
        description: 'A 30-question burnout assessment, a 4-week recovery plan, and daily check-in templates.',
        resource_type: 'worksheet',
        catSlug: 'healthcare',
        subSlug: 'mental-health',
        l3Slug: 'burnout',
        episode_ref: 'Wellbeing Series',
        pages: 12,
        icon: '📓',
        cover_color: 'linear-gradient(135deg,#831843,#DB2777,#F9A8D4)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Mindfulness for Ambitious Women — A Practical Guide',
        description: 'Evidence-based mindfulness techniques adapted for women managing careers, study, and personal goals.',
        resource_type: 'guide',
        catSlug: 'healthcare',
        subSlug: 'mental-health',
        l3Slug: null,
        episode_ref: 'Wellbeing Series',
        pages: 10,
        icon: '🧘',
        cover_color: 'linear-gradient(135deg,#4A044E,#9333EA,#E879F9)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'The Imposter Syndrome Toolkit',
        description: 'Confidence audit, cognitive reframing exercises, and affirmations used by our guests to overcome imposter syndrome.',
        resource_type: 'toolkit',
        catSlug: 'healthcare',
        subSlug: 'mental-health',
        l3Slug: null,
        episode_ref: 'All Episodes',
        pages: 8,
        icon: '🛡️',
        cover_color: 'linear-gradient(135deg,#3B0764,#9333EA,#D8B4FE)',
        is_coming_soon: false,
        is_featured: false
      },

      // 5. Creative Arts & Media
      {
        title: 'Breaking Into the Creative Industry — A Realistic Guide',
        description: 'The truth about creative careers: income, portfolios, pitching, and building a sustainable creative practice.',
        resource_type: 'guide',
        catSlug: 'creative-and-media',
        subSlug: 'content-creation',
        l3Slug: null,
        episode_ref: 'Creative Series',
        pages: 14,
        icon: '🎨',
        cover_color: 'linear-gradient(135deg,#431407,#C2410C,#FB923C)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Creative Portfolio Template — What to Include',
        description: 'A checklist and framework for building your first professional portfolio across design, writing, film, and more.',
        resource_type: 'template',
        catSlug: 'creative-and-media',
        subSlug: 'content-creation',
        l3Slug: null,
        episode_ref: 'Creative Series',
        pages: 6,
        icon: '🖼️',
        cover_color: 'linear-gradient(135deg,#7C2D12,#EA580C,#FED7AA)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Creative Reading List — Books Every Aspiring Artist Should Read',
        description: 'From "Steal Like an Artist" to "Big Magic" — curated recommendations from BBG\'s creative guests.',
        resource_type: 'reading',
        catSlug: 'creative-and-media',
        subSlug: 'content-creation',
        l3Slug: null,
        episode_ref: 'All Episodes',
        pages: 5,
        icon: '📖',
        cover_color: 'linear-gradient(135deg,#292524,#78716C,#D6D3D1)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Creative Freelance Rate-Setting & Pitch Script',
        description: 'How to charge your worth: rate calculator, email scripts for negotiating freelance projects, and a pitch template.',
        resource_type: 'script',
        catSlug: 'creative-and-media',
        subSlug: 'content-creation',
        l3Slug: 'monetization',
        episode_ref: 'Creative Series',
        pages: 8,
        icon: '✉️',
        cover_color: 'linear-gradient(135deg,#831843,#EC4899,#FBCFE8)',
        is_coming_soon: false,
        is_featured: false
      },

      // 6. Finance & Wealth
      {
        title: 'Money Mindsets — EP. 04 Full Insight PDF',
        description: 'Afnan Khalifa\'s complete framework for building wealth, key takeaways, and a personal finance action plan.',
        resource_type: 'pdf',
        catSlug: 'finance',
        subSlug: 'personal-finance',
        l3Slug: 'financial-independence',
        episode_ref: 'EP. 04',
        pages: 8,
        icon: '💰',
        cover_color: 'linear-gradient(135deg,#082F49,#0C4A6E,#0EA5E9)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Women in Finance Salary Report 2025',
        description: 'Salary benchmarks across investment banking, accounting, fintech, and insurance — with negotiation tips.',
        resource_type: 'salary',
        catSlug: 'finance',
        subSlug: 'accounting-and-operation',
        l3Slug: null,
        episode_ref: 'Research',
        pages: 24,
        icon: '📊',
        cover_color: 'linear-gradient(135deg,#0C4A6E,#0284C7,#38BDF8)',
        is_coming_soon: false,
        is_featured: true
      },
      {
        title: 'Personal Finance Starter Workbook',
        description: 'Budgeting templates, debt tracker, savings goal calculator, and a step-by-step guide to your first investment.',
        resource_type: 'worksheet',
        catSlug: 'finance',
        subSlug: 'personal-finance',
        l3Slug: null,
        episode_ref: 'Finance Series',
        pages: 16,
        icon: '📓',
        cover_color: 'linear-gradient(135deg,#134E4A,#0F766E,#2DD4BF)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'How to Break Into Investment Banking — A Guide for Women',
        description: 'The insider\'s guide to landing your first role in investment banking, with real advice from finance professionals.',
        resource_type: 'guide',
        catSlug: 'finance',
        subSlug: 'investment-banking',
        l3Slug: null,
        episode_ref: 'Finance Series',
        pages: 18,
        icon: '📈',
        cover_color: 'linear-gradient(135deg,#082F49,#0369A1,#0EA5E9)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Finance CV Template — Stand Out on the Trading Floor',
        description: 'A sleek, recruiter-approved CV template for finance roles, with a real example and cover letter framework.',
        resource_type: 'template',
        catSlug: 'finance',
        subSlug: 'investment-banking',
        l3Slug: null,
        episode_ref: 'Finance Series',
        pages: 4,
        icon: '📋',
        cover_color: 'linear-gradient(135deg,#0F172A,#1E3A5F,#3B82F6)',
        is_coming_soon: false,
        is_featured: false
      },

      // 7. Healthcare & Medicine
      {
        title: 'Medicine as a Career — What Nobody Tells You',
        description: 'The full picture: medical school applications, junior doctor life, specialisation, and the realities women face in medicine.',
        resource_type: 'guide',
        catSlug: 'healthcare',
        subSlug: 'medicine',
        l3Slug: null,
        episode_ref: 'Healthcare Series',
        pages: 16,
        icon: '🩺',
        cover_color: 'linear-gradient(135deg,#022C22,#065F46,#34D399)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Medical School Personal Statement Template',
        description: 'A structured personal statement framework with prompts, word counts, and example openings for medical applications.',
        resource_type: 'template',
        catSlug: 'healthcare',
        subSlug: 'medicine',
        l3Slug: null,
        episode_ref: 'Healthcare Series',
        pages: 5,
        icon: '📝',
        cover_color: 'linear-gradient(135deg,#064E3B,#0F766E,#6EE7B7)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Healthcare Reading List — Curated by Our Medical Guests',
        description: 'The books, journals and documentaries every aspiring healthcare professional should engage with.',
        resource_type: 'reading',
        catSlug: 'healthcare',
        subSlug: 'medicine',
        l3Slug: null,
        episode_ref: 'All Episodes',
        pages: 6,
        icon: '📚',
        cover_color: 'linear-gradient(135deg,#022C22,#065F46,#10B981)',
        is_coming_soon: false,
        is_featured: false
      },

      // 8. Education & Teaching
      {
        title: 'A Career in Education — All Your Options',
        description: 'From classroom teaching to EdTech, curriculum design and academia — a complete overview of education career paths.',
        resource_type: 'guide',
        catSlug: 'education-and-academia',
        subSlug: 'teaching',
        l3Slug: null,
        episode_ref: 'Education Series',
        pages: 12,
        icon: '🏫',
        cover_color: 'linear-gradient(135deg,#2E1065,#6B21A8,#A855F7)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Goal Setting Workbook for Students & Graduates',
        description: 'A 90-day goal-setting framework with weekly check-ins, habit tracking, and reflection prompts.',
        resource_type: 'worksheet',
        catSlug: 'education-and-academia',
        subSlug: 'teaching',
        l3Slug: null,
        episode_ref: 'All Episodes',
        pages: 14,
        icon: '📓',
        cover_color: 'linear-gradient(135deg,#3B0764,#7C3AED,#DDD6FE)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Networking Email Templates for Students',
        description: '7 done-for-you email templates: cold outreach, LinkedIn connection requests, mentorship asks, and follow-ups.',
        resource_type: 'script',
        catSlug: 'education-and-academia',
        subSlug: 'teaching',
        l3Slug: null,
        episode_ref: 'All Episodes',
        pages: 6,
        icon: '✉️',
        cover_color: 'linear-gradient(135deg,#1E1B4B,#4338CA,#A5B4FC)',
        is_coming_soon: false,
        is_featured: false
      }
    ];

    for (let i = 0; i < resources.length; i++) {
      const r = resources[i];
      const catId = categoryMap[r.catSlug] || null;
      const subId = subcategoryMap[`${r.catSlug}_${r.subSlug}`] || null;
      const sfId = r.l3Slug ? (specializedFieldMap[`${r.catSlug}_${r.subSlug}_${r.l3Slug}`] || null) : null;

      await Resource.create({
        title: r.title,
        description: r.description,
        resource_type: r.resource_type,
        category_id: catId,
        subcategory_id: subId,
        specialized_field_id: sfId,
        episode_ref: r.episode_ref,
        pages: r.pages,
        icon: r.icon,
        cover_color: r.cover_color,
        is_coming_soon: r.is_coming_soon,
        is_featured: r.is_featured,
        sort_order: i,
        status: 'published'
      });
    }
    console.log('Resources seeded!');

    // 7. Seed Mentors
    console.log('Seeding mentors...');
    const mentorsData = [
      {
        name: 'Priya Sharma',
        role: 'Senior Product Manager · Google',
        photo: '',
        bio: "Ex-startup PM, now Senior PM at Google. I help women break into product and negotiate offers they're proud of.",
        quote: '',
        availability: 'Tomorrow',
        catSlug: 'technology',
        expertise_areas: 'Career pivots, PM interviews, Negotiation',
        rate: '$20',
        is_featured: true,
        durs: ['30', '60'],
        slots: ["09:00", "09:30", "10:00", "11:00", "11:30", "14:00", "14:30", "15:00", "16:00", "16:30"],
        busy: ["11:00", "15:00"]
      },
      {
        name: 'Vanya Mehta',
        role: 'Founder & CEO · FinTech',
        photo: '',
        bio: "Raised $2M and scaled a fintech to 50k users. I demystify fundraising and early growth for women founders.",
        quote: '',
        availability: 'Fri',
        catSlug: 'finance',
        expertise_areas: 'Fundraising, Startups, Growth',
        rate: '$36',
        is_featured: true,
        durs: ['60'],
        slots: ["09:00", "09:30", "10:30", "13:00", "13:30", "16:00", "16:30", "17:00"],
        busy: ["09:30", "16:30"]
      },
      {
        name: 'Pehal Kaur',
        role: 'Corporate Lawyer',
        photo: '',
        bio: "Corporate lawyer who's closed contracts north of $1M. I guide women into legal leadership and sharper negotiation.",
        quote: '',
        availability: 'Today',
        catSlug: 'law',
        expertise_areas: 'Contracts, Negotiation, Legal careers',
        rate: '$20',
        is_featured: true,
        durs: ['30', '60'],
        slots: ["08:30", "09:00", "09:30", "11:00", "11:30", "15:00", "15:30", "16:00", "16:30"],
        busy: ["09:00", "15:30"]
      },
      {
        name: 'Jane Williams',
        role: 'Marketing Director · Agency',
        photo: '',
        bio: "Marketing Director who grew a brand from zero to 2M. I help you find positioning that actually converts.",
        quote: '',
        availability: 'Mon',
        catSlug: 'business',
        expertise_areas: 'Brand strategy, Content, Positioning',
        rate: '$36',
        is_featured: true,
        durs: ['60', '120'],
        slots: ["10:00", "10:30", "11:00", "11:30", "13:00", "13:30", "15:00", "15:30"],
        busy: ["11:30", "13:00"]
      },
      {
        name: 'Erica Thompson',
        role: 'Healthcare Administrator',
        photo: '',
        bio: "Led 120 clinicians across four hospitals. I coach women navigating healthcare operations and leadership.",
        quote: '',
        availability: 'Today',
        catSlug: 'healthcare',
        expertise_areas: 'Leadership, Operations, Strategy',
        rate: '$20',
        is_featured: true,
        durs: ['30'],
        slots: ["07:00", "07:30", "08:00", "08:30", "12:00", "12:30", "13:00", "13:30"],
        busy: ["07:30", "13:00"]
      },
      {
        name: 'Lucy Chen',
        role: 'Software Engineer · Spotify',
        photo: '',
        bio: "Went bootcamp-to-Spotify in 14 months. I help career changers land their first real engineering role.",
        quote: '',
        availability: 'Wed',
        catSlug: 'technology',
        expertise_areas: 'Bootcamp to job, Frontend, Interviews',
        rate: '$20',
        is_featured: true,
        durs: ['30', '60'],
        slots: ["09:30", "10:00", "10:30", "14:00", "14:30", "15:00", "17:00", "17:30"],
        busy: ["10:00", "15:00"]
      }
    ];

    const mentorMap = {};
    for (const m of mentorsData) {
      const catId = categoryMap[m.catSlug] || null;
      const email = `${m.name.toLowerCase().replace(/\s+/g, '')}@bnbgirl.com`;
      const password = 'password123';
      const dbMentor = await Mentor.create({
        name: m.name,
        email,
        password,
        role: m.role,
        photo: m.photo,
        bio: m.bio,
        quote: m.quote,
        availability: m.availability,
        category_id: catId,
        expertise_areas: m.expertise_areas,
        rate: m.rate,
        is_featured: m.is_featured,
        durs: m.durs,
        slots: m.slots,
        busy: m.busy,
        status: 'published'
      });
      mentorMap[m.name] = dbMentor._id;
    }
    console.log('Mentors seeded!');

    console.log('Seeding mock mentorship bookings...');
    const priyaId = mentorMap['Priya Sharma'];
    const vanyaId = mentorMap['Vanya Mehta'];

    if (priyaId) {
      await Submission.create({
        form_type: 'mentorship',
        data: {
          mentor: 'Priya Sharma',
          mentor_id: String(priyaId),
          duration: '30',
          date: '2026-06-25',
          time: '09:30',
          email: 'student1@example.com',
          amount: '$20',
          meet_link: 'https://meet.google.com/abc-defg-hij',
          goals: 'Looking to transition from QA to Product Management. Need resume review and strategy.',
          submitted_at: new Date().toISOString()
        }
      });

      await Submission.create({
        form_type: 'mentorship',
        data: {
          mentor: 'Priya Sharma',
          mentor_id: String(priyaId),
          duration: '60',
          date: '2026-06-28',
          time: '14:00',
          email: 'student2@example.com',
          amount: '$36',
          meet_link: 'https://meet.google.com/xyz-pdqr-lmn',
          goals: 'Need salary negotiation tips for a Senior PM offer at Amazon.',
          reschedule_request: {
            status: 'pending',
            date: '2026-06-29',
            time: '10:00',
            submitted_at: new Date().toISOString()
          },
          submitted_at: new Date().toISOString()
        }
      });
    }

    if (vanyaId) {
      await Submission.create({
        form_type: 'mentorship',
        data: {
          mentor: 'Vanya Mehta',
          mentor_id: String(vanyaId),
          duration: '60',
          date: '2026-06-26',
          time: '10:30',
          email: 'founder_hopeful@example.com',
          amount: '$36',
          meet_link: 'https://meet.google.com/mno-pqrs-tuv',
          goals: 'Demystifying fundraising strategy for our pre-seed stage fintech SaaS.',
          submitted_at: new Date().toISOString()
        }
      });
    }
    console.log('Mock mentorship bookings seeded!');

    console.log('Seeding completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seed();
