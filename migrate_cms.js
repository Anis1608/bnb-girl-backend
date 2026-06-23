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
  cms_about_contact_email: "sanah@bnbgirl.com",
  // Series / Curated Collections CMS
  cms_series_stem_title: "Women in STEM", cms_series_stem_epcount: "8 Episodes", cms_series_stem_category: "tech", cms_series_stem_youtube: "", cms_series_stem_percentage: "25%",
  cms_series_entrepreneurship_title: "Entrepreneurship Diaries", cms_series_entrepreneurship_epcount: "6 Episodes", cms_series_entrepreneurship_category: "business", cms_series_entrepreneurship_youtube: "", cms_series_entrepreneurship_percentage: "0%",
  cms_series_mental_title: "Mental Health & Career", cms_series_mental_epcount: "4 Episodes", cms_series_mental_category: "health", cms_series_mental_youtube: "", cms_series_mental_percentage: "50%",
  cms_series_law_title: "Breaking Barriers in Law", cms_series_law_epcount: "5 Episodes", cms_series_law_category: "law", cms_series_law_youtube: "", cms_series_law_percentage: "0%",
  cms_series_creative_title: "The Creative Career", cms_series_creative_epcount: "7 Episodes", cms_series_creative_category: "arts", cms_series_creative_youtube: "", cms_series_creative_percentage: "14%",
  cms_series_finance_title: "Corporate & Finance", cms_series_finance_epcount: "5 Episodes", cms_series_finance_category: "finance", cms_series_finance_youtube: "", cms_series_finance_percentage: "0%",
  // Spotlight / This Week's Guest CMS
  cms_spotlight_mentor_id: "",
  // Mentorship Page CMS
  cms_mentor_hero_badge: "Verified women mentors · 100% confidential",
  cms_mentor_hero_title: "The gap between where you are and where you want to be is<br /><em>one right mentor.</em>",
  cms_mentor_hero_subtitle1: "Most women stay stuck not because they lack talent or drive — nobody ever showed them the door.",
  cms_mentor_hero_subtitle2: "Every mentor here has walked the road you're on.",
  cms_mentor_hero_podcast_text: "As heard on the Bold &amp; Brilliant Girls podcast",
  cms_mentor_hero_metric1_val: "87%",
  cms_mentor_hero_metric1_lbl: "feel more confident within 6 months",
  cms_mentor_hero_metric2_val: "3×",
  cms_mentor_hero_metric2_lbl: "more likely to get promoted",
  cms_mentor_hero_metric3_val: "$85K",
  cms_mentor_hero_metric3_lbl: "average salary jump in 2 years",
  cms_mentor_hero_metric4_val: "500+",
  cms_mentor_hero_metric4_lbl: "verified mentors across fields",
  cms_mentor_ticker: "A mentor doesn't make you smarter — they make your path shorter;The right introduction opens doors a hundred cold emails never could;What took someone ten years to learn, they can teach you in one hour;Clarity is the rarest career resource. A great mentor gives you exactly that;The highest performers had someone who believed in them first",
  cms_mentor_list_title: "Meet your <em>mentors.</em>",
  cms_mentor_list_quiz_lbl: "Not sure who fits? Take the 2-min match",
  cms_mentor_stories_eyebrow: "Real stories",
  cms_mentor_stories_title: "Women who took the leap — <em>and landed.</em>",
  cms_mentor_stories_subtitle: "Real names, real roles, real outcomes. Every story started with one conversation.",
  cms_mentor_stories_trust1_val: "4.9",
  cms_mentor_stories_trust1_lbl: "average session rating",
  cms_mentor_stories_trust2_val: "2,400+",
  cms_mentor_stories_trust2_lbl: "sessions booked",
  cms_mentor_stories_trust3_val: "98%",
  cms_mentor_stories_trust3_lbl: "would recommend",
  cms_mentor_story1_quote: "She helped me see I was ready for a role I had talked myself out of for a year.",
  cms_mentor_story1_outcome: "Promoted to Senior PM",
  cms_mentor_story1_author: "Aarti N.",
  cms_mentor_story1_title: "Product Manager · Bengaluru",
  cms_mentor_story1_via: "Mentored by Priya Sharma",
  cms_mentor_story2_quote: "I walked in unsure and left with a 90-day plan and a warm intro to a hiring manager.",
  cms_mentor_story2_outcome: "Landed a tech role",
  cms_mentor_story2_author: "Sneha R.",
  cms_mentor_story2_title: "Software Engineer · Hyderabad",
  cms_mentor_story2_via: "Mentored by Lucy Chen",
  cms_mentor_story3_quote: "My mentor had raised the exact round I was terrified of. One hour saved me months.",
  cms_mentor_story3_outcome: "Closed $500K pre-seed",
  cms_mentor_story3_author: "Preethi M.",
  cms_mentor_story3_title: "Founder · Mumbai",
  cms_mentor_story3_via: "Mentored by Vanya Mehta",
  cms_mentor_companies_title: "Our mentors come from",
  cms_mentor_companies_list: "Google;Meta;Amazon;Spotify;& more",
  cms_mentor_why_eyebrow: "Why it works",
  cms_mentor_why_title: "Career growth isn't luck.<br />It's <em>guided.</em>",
  cms_mentor_why_subtitle: "The biggest predictor of advancement isn't talent — it's access to someone who's already solved the problem in front of you.",
  cms_mentor_why_stat1_val: "87%",
  cms_mentor_why_stat1_lbl: "Feel more confident",
  cms_mentor_why_stat1_sub: "within 6 months · HBR",
  cms_mentor_why_stat2_val: "3×",
  cms_mentor_why_stat2_lbl: "More likely promoted",
  cms_mentor_why_stat2_sub: "vs. non-mentored · McKinsey",
  cms_mentor_why_stat3_val: "94%",
  cms_mentor_why_stat3_lbl: "Session satisfaction",
  cms_mentor_why_stat3_sub: "across 2,400+ sessions",
  cms_mentor_why_stat4_val: "$85K",
  cms_mentor_why_stat4_lbl: "Avg. salary jump",
  cms_mentor_why_stat4_sub: "within 2 years · Mentoring.org",
  cms_mentor_why_foot_text: "One conversation can change the trajectory of your <em>whole career.</em>",
  cms_mentor_why_foot_btn: "Book a session",
  cms_mentor_faq_eyebrow: "Questions",
  cms_mentor_faq_title: "Everything you<br />need to <em>know.</em>",
  cms_mentor_faq_subtitle: "Browse the mentors above — you can read every profile before booking a thing.",
  cms_mentor_faq_q1: "How are mentors verified?",
  cms_mentor_faq_a1: "Every mentor completes identity verification and a background check, and we confirm their professional history before they can take a session.",
  cms_mentor_faq_q2: "What happens in a session?",
  cms_mentor_faq_a2: "A private one-to-one video call. You bring a question or a goal; your mentor brings lived experience. Most people leave with a clear next step.",
  cms_mentor_faq_q3: "What does it cost?",
  cms_mentor_faq_a3: "Sessions start at $20 for a focused 30-minute conversation. Longer sessions are priced by each mentor and shown upfront. No subscriptions.",
  cms_mentor_faq_q4: "Is it really confidential?",
  cms_mentor_faq_a4: "Yes. What you discuss stays between you and your mentor. We never share session content, and your booking details stay private.",
  cms_mentor_faq_q5: "What if I need to reschedule?",
  cms_mentor_faq_a5: "You can reschedule or cancel up to 24 hours before your session at no cost, directly from your confirmation email.",
  cms_mentor_faq_q6: "Do I have to commit to a package?",
  cms_mentor_faq_a6: "No. Book one session, see how it feels, and come back when you need to. There is no commitment beyond the session you book."
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
