import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import nodemailer from 'nodemailer';
import Parser from 'rss-parser';

const app = express();
const PORT = 3000;

app.use(express.json());

// --- Lazy Initialization of Clients ---
let supabaseClient: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key || url.includes('your-project')) {
      throw new Error('Supabase configuration is missing or invalid. Please set SUPABASE_URL and SUPABASE_ANON_KEY.');
    }
    supabaseClient = createClient(url, key);
  }
  return supabaseClient;
}

let aiClient: GoogleGenAI | null = null;
function getAI() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    if (key === 'MY_GEMINI_API_KEY' || key.includes('your-')) {
      throw new Error('It looks like you are using a placeholder Gemini API key. Please ensure you have a valid key.');
    }
    console.log('Initializing Gemini with key starting with:', key.substring(0, 4));
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
}

let mailTransporter: nodemailer.Transporter | null = null;
function getMailer() {
  if (!mailTransporter) {
    const user = process.env.GMAIL_ADDRESS;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass || user.includes('your-email')) {
      throw new Error('Gmail configuration is missing or invalid. Please set GMAIL_ADDRESS and GMAIL_APP_PASSWORD.');
    }
    mailTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass }
    });
  }
  return mailTransporter;
}

const rssParser = new Parser();

// --- API Routes ---

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Config status check for frontend
app.get('/api/config-status', (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const gmail = process.env.GMAIL_ADDRESS;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  const isSupabaseConfigured = !!(supabaseUrl && supabaseKey && !supabaseUrl.includes('your-project'));
  const isGmailConfigured = !!(gmail && gmailPass && !gmail.includes('your-email'));

  res.json({
    supabase: isSupabaseConfigured,
    gmail: isGmailConfigured,
    ready: isSupabaseConfigured && isGmailConfigured
  });
});

// Get articles for the frontend
app.get('/api/articles', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('articles')
      .select('*')
      .order('published_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json({ articles: data || [] });
  } catch (error: any) {
    console.error('Error fetching articles:', error);
    res.status(500).json({ error: error.message });
  }
});

// Trigger the crawler, summarizer, and email pipeline
app.all('/api/trigger-pipeline', async (req, res) => {
  // Security Check: Verify CRON_SECRET
  const authHeader = req.headers.authorization;
  const querySecret = req.query.secret;
  const expectedSecret = process.env.VITE_CRON_SECRET;

  if (expectedSecret) {
    const isAuthorized = 
      (authHeader === `Bearer ${expectedSecret}`) || 
      (querySecret === expectedSecret);
      
    if (!isAuthorized) {
      return res.status(401).json({ error: 'Unauthorized. Invalid CRON_SECRET.' });
    }
  }

  try {
    const supabase = getSupabase();
    const ai = getAI();
    const mailer = getMailer();
    
    // 1. Fetch from multiple sources
    const itemsToProcess: any[] = [];
    
    // Source A: ArXiv cs.AI
    try {
      const arxivFeed = await rssParser.parseURL('http://export.arxiv.org/rss/cs.AI');
      const arxivItems = arxivFeed.items.slice(0, 15).map(item => ({
        title: item.title,
        link: item.link,
        contentSnippet: item.contentSnippet || item.content,
        source: 'ArXiv cs.AI',
        isoDate: item.isoDate || new Date().toISOString()
      }));
      itemsToProcess.push(...arxivItems);
    } catch (e) {
      console.error('Error fetching ArXiv:', e);
    }

    // Source B: Hugging Face Daily Papers
    try {
      const hfFeed = await rssParser.parseURL('https://huggingface.co/blog/feed.xml');
      const hfItems = hfFeed.items.slice(0, 10).map(item => ({
        title: item.title,
        link: item.link,
        contentSnippet: item.contentSnippet || item.content,
        source: 'Hugging Face',
        isoDate: item.isoDate || new Date().toISOString()
      }));
      itemsToProcess.push(...hfItems);
    } catch (e) {
      console.error('Error fetching Hugging Face:', e);
    }

    // Source C: Reddit r/MachineLearning
    try {
      const redditRes = await fetch('https://www.reddit.com/r/MachineLearning/hot.json?limit=15');
      if (!redditRes.ok) {
        console.error('Reddit API returned status:', redditRes.status);
      } else {
        const redditData = await redditRes.json();
        const redditItems = redditData.data.children
          .filter((child: any) => !child.data.stickied) // Skip pinned posts
          .slice(0, 10)
          .map((child: any) => ({
            title: child.data.title,
            link: `https://reddit.com${child.data.permalink}`,
            contentSnippet: child.data.selftext || child.data.title,
            source: 'r/MachineLearning',
            isoDate: new Date(child.data.created_utc * 1000).toISOString()
          }));
        itemsToProcess.push(...redditItems);
      }
    } catch (e) {
      console.error('Error fetching Reddit:', e);
    }

    // Source D: Google AI Blog
    try {
      const googleFeed = await rssParser.parseURL('https://blog.google/technology/ai/rss/');
      const googleItems = googleFeed.items.slice(0, 2).map(item => ({
        title: item.title,
        link: item.link,
        contentSnippet: item.contentSnippet || item.content,
        source: 'Google AI',
        isoDate: item.isoDate || new Date().toISOString()
      }));
      itemsToProcess.push(...googleItems);
    } catch (e) {
      console.error('Error fetching Google AI:', e);
    }

    // Source E: Anthropic (Removed due to 404 - no standard RSS feed available)
    
    const newArticles = [];
    let aiProcessedCount = 0;
    
    for (const item of itemsToProcess) {
      if (!item.link) continue;
      if (aiProcessedCount >= 5) {
        console.log('Reached max AI processing limit for this run (5) to avoid rate limits.');
        break;
      }
      
      // 2. Deduplication check
      const { data: existing } = await supabase
        .from('articles')
        .select('id')
        .eq('link', item.link)
        .single();
        
      if (existing) continue; // Skip if already processed
      
      // 3. Summarization via Gemini
      aiProcessedCount++;
      const prompt = `You are an expert science communicator who explains complex AI news to absolute beginners and non-technical people (like a friendly teacher). 
      Read the following AI news/paper and break it down.
      
      Format the output as JSON with keys: "tldr" (string) and "keyPoints" (array of strings).
      
      Rules:
      1. "tldr": Write a 2-sentence explanation of what happened. Use ZERO technical jargon. Use a simple, everyday analogy if it helps.
      2. "keyPoints": Provide exactly 3 bullet points in this EXACT format (including the emojis and bolding):
         - "🎯 **Why it matters:** [Explain the real-world impact on everyday people or businesses]"
         - "💡 **The big change:** [Explain what is actually new or different in plain English]"
         - "🔮 **What's next:** [Explain what this means for the future]"
      
      Title: ${item.title}
      Content: ${item.contentSnippet}`;
      
      let summaryJson;
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.2
          }
        });
        
        const summaryText = response.text;
        if (!summaryText) continue;
        
        // Strip out markdown code blocks if the LLM adds them
        const cleanText = summaryText.replace(/```json/g, '').replace(/```/g, '').trim();
        summaryJson = JSON.parse(cleanText);
      } catch (aiError) {
        console.error('Error generating or parsing summary:', aiError);
        await new Promise(resolve => setTimeout(resolve, 4000)); // Sleep on error too
        continue; // Skip this article if AI fails
      }
      
      await new Promise(resolve => setTimeout(resolve, 4000)); // Sleep to respect 15 RPM limit
      
      // 4. Save to Supabase
      const articleData = {
        title: item.title,
        link: item.link,
        source: item.source,
        published_at: item.isoDate,
        tldr: summaryJson.tldr,
        key_points: summaryJson.keyPoints,
        faithfulness_score: 0.95 // Mocked for this demo, would normally use NLI evaluation
      };
      
      const { error } = await supabase.from('articles').insert([articleData]);
      if (error) {
        console.error('Error saving article:', error);
        continue;
      }
      
      newArticles.push(articleData);
    }
    
    // 5. Send Email if there are new articles
    let emailStatus = 'skipped';
    if (newArticles.length > 0) {
      const emailHtml = `
        <h2>🚀 Your Daily AI Research Summaries</h2>
        <p>Found ${newArticles.length} new articles.</p>
        <hr/>
        ${newArticles.map(a => `
          <div style="margin-bottom: 20px;">
            <h3><a href="${a.link}">${a.title}</a></h3>
            <p><strong>Source:</strong> ${a.source}</p>
            <p><strong>TL;DR:</strong> ${a.tldr}</p>
            <ul>
              ${a.key_points.map((kp: string) => `<li>${kp}</li>`).join('')}
            </ul>
          </div>
        `).join('')}
      `;
      
      try {
        await mailer.sendMail({
          from: process.env.GMAIL_ADDRESS,
          to: process.env.GMAIL_ADDRESS,
          subject: `🚀 ${newArticles.length} New AI Research Summaries`,
          html: emailHtml
        });
        emailStatus = 'sent';
      } catch (emailError: any) {
        console.error('Error sending email:', emailError);
        emailStatus = `failed: ${emailError.message}`;
      }
    }
    
    res.json({ 
      status: 'success', 
      processed: itemsToProcess.length,
      newArticlesAdded: newArticles.length,
      emailStatus
    });
    
  } catch (error: any) {
    console.error('Pipeline error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Vite Middleware ---
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
