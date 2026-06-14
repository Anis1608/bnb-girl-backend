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
    console.log('Cleared!');

    // 2. Seed Default Admin User
    console.log('Seeding default Admin...');
    const adminUser = new User({
      username: 'admin',
      password: 'admin123'
    });
    await adminUser.save();
    console.log('Admin seeded! (Username: admin, Password: admin123)');

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
      {
        title: "Girls' Education Career Playbook — Dr. Sheen Gurrib",
        description: '7-page summary with key takeaways, quotes, and action items.',
        resource_type: 'pdf',
        catSlug: 'education-and-academia',
        subSlug: 'teaching',
        l3Slug: null,
        episode_ref: 'EP. 01',
        pages: 12,
        icon: '🎓',
        cover_color: 'linear-gradient(135deg,#6B21A8,#EC4899)',
        is_coming_soon: false,
        is_featured: true
      },
      {
        title: 'Building Wealth — Money Mindsets PDF',
        description: 'Investment basics, budgeting templates, and wealth-building tips.',
        resource_type: 'guide',
        catSlug: 'finance',
        subSlug: 'personal-finance',
        l3Slug: 'financial-independence',
        episode_ref: 'EP. 04',
        pages: 8,
        icon: '💰',
        cover_color: 'linear-gradient(135deg,#EAB308,#F97316)',
        is_coming_soon: false,
        is_featured: true
      },
      {
        title: 'Confidence Blueprint — Your Guide',
        description: 'Imposter syndrome toolkit, daily affirmations, and exercises.',
        resource_type: 'toolkit',
        catSlug: 'healthcare',
        subSlug: 'mental-health',
        l3Slug: 'emotional-resilience',
        episode_ref: 'EP. 05',
        pages: 6,
        icon: '⚡',
        cover_color: 'linear-gradient(135deg,#EC4899,#9333EA)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Women in Finance — Salary Report 2025',
        description: 'Real salary data across banking, investment, fintech and accounting.',
        resource_type: 'salary',
        catSlug: 'finance',
        subSlug: 'accounting-and-operation',
        l3Slug: null,
        episode_ref: 'Research',
        pages: 24,
        icon: '📊',
        cover_color: 'linear-gradient(135deg,#082F49,#0369A1,#38BDF8)',
        is_coming_soon: false,
        is_featured: true
      },
      {
        title: 'Women in Tech — Interview Prep Kit',
        description: '50 common tech interview questions, STAR templates, and confidence frameworks.',
        resource_type: 'toolkit',
        catSlug: 'technology',
        subSlug: 'software-engineering',
        l3Slug: 'frontend',
        episode_ref: 'STEM Series',
        pages: 18,
        icon: '💻',
        cover_color: 'linear-gradient(135deg,#022C22,#065F46,#34D399)',
        is_coming_soon: false,
        is_featured: false
      },
      {
        title: 'Breaking Into Law — The Complete Playbook',
        description: 'Bar exam timelines, law school application guide, and networking scripts for aspiring lawyers.',
        resource_type: 'guide',
        catSlug: 'law',
        subSlug: 'corporate-law',
        l3Slug: 'legal-operations',
        episode_ref: 'Law Series',
        pages: 0,
        icon: '⚖️',
        cover_color: 'linear-gradient(135deg,#1E1B4B,#4338CA,#818CF8)',
        is_coming_soon: true,
        is_featured: false
      },
      {
        title: "Founder's Toolkit — Starting From Zero",
        description: 'Business model canvas, pitch deck templates, and a step-by-step idea validation guide.',
        resource_type: 'toolkit',
        catSlug: 'business',
        subSlug: 'entrepreneurship',
        l3Slug: 'first-time-founders',
        episode_ref: 'Business Series',
        pages: 0,
        icon: '💡',
        cover_color: 'linear-gradient(135deg,#78350F,#D97706,#FCD34D)',
        is_coming_soon: true,
        is_featured: false
      },
      {
        title: 'Creative Industry Rate Card & Negotiation Guide',
        description: 'Freelance rates, agency salaries, and scripts for negotiating your creative fees.',
        resource_type: 'script',
        catSlug: 'creative-and-media',
        subSlug: 'content-creation',
        l3Slug: 'monetization',
        episode_ref: 'Creative Series',
        pages: 0,
        icon: '🎨',
        cover_color: 'linear-gradient(135deg,#431407,#C2410C,#FCA5A1)',
        is_coming_soon: true,
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

    console.log('Seeding completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seed();
