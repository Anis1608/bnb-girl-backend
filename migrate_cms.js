const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Option = require('./models/Option');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bbg-platform';

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

async function migrate() {
  console.log('Connecting to database:', MONGODB_URI);
  await mongoose.connect(MONGODB_URI);
  console.log('Connected successfully!');

  let insertedCount = 0;
  let skippedCount = 0;

  for (const [key, value] of Object.entries(cmsDefaults)) {
    const existing = await Option.findOne({ key });
    if (!existing) {
      await Option.create({ key, value });
      insertedCount++;
    } else {
      skippedCount++;
    }
  }

  console.log(`Migration complete! Seeded ${insertedCount} default options, skipped ${skippedCount} existing custom options.`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
