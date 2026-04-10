import React, { useState, useEffect } from 'react';
import { 
  AlertTriangle, 
  ExternalLink, 
  CheckCircle, 
  Play, 
  Loader2, 
  Calendar,
  Cpu,
  Sparkles,
  Target,
  ArrowRight
} from 'lucide-react';

// --- Types ---
interface Article {
  id: number;
  title: string;
  link: string;
  source: string;
  published_at: string;
  tldr: string;
  key_points: string[];
  faithfulness_score: number;
}

interface ConfigStatus {
  supabase: boolean;
  gmail: boolean;
  ready: boolean;
}

// --- Components ---

const ConfigWarning = () => (
  <div className="bg-[#fee2e2] border border-[#f87171] p-5 rounded-lg mb-8 flex items-start gap-4">
    <AlertTriangle className="text-[#b91c1c] shrink-0 mt-0.5" size={20} />
    <div>
      <h3 className="text-[#7f1d1d] font-bold text-base">Configuration Required</h3>
      <p className="text-[#991b1b] text-sm mt-1">
        Please configure Supabase and Gmail secrets in the AI Studio Settings.
      </p>
    </div>
  </div>
);

const ArticleCard = ({ article }: { article: Article }) => {
  const formattedDate = new Date(article.published_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-8 mb-8 shadow-sm hover:shadow-md transition-all">
      {/* Header / Source */}
      <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#e0e7ff] flex items-center justify-center text-[#1e1b4b] shrink-0">
            <Target size={24} />
          </div>
          <div>
            <span className="text-lg font-extrabold text-[#1e1b4b] tracking-tight">{article.source}</span>
            <div className="text-sm text-slate-500 flex items-center gap-1.5 mt-0.5 font-medium">
              <Calendar size={14} /> {formattedDate}
            </div>
          </div>
        </div>
        <a 
          href={article.link} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-[#1e1b4b] hover:text-white bg-slate-100 hover:bg-[#1e1b4b] p-3 rounded-full transition-colors"
        >
          <ExternalLink size={18} />
        </a>
      </div>

      {/* Title */}
      <h3 className="text-2xl md:text-3xl font-extrabold text-[#1e1b4b] mb-6 leading-snug tracking-tight">
        {article.title}
      </h3>

      {/* TL;DR Callout (Lavender Box matching the PDF style) */}
      <div className="bg-[#e0e7ff] rounded-lg p-6 mb-8 flex gap-4 border border-[#c7d2fe]">
        <Sparkles className="text-[#1e1b4b] shrink-0 mt-0.5" size={24} />
        <div>
          <h4 className="font-bold text-[#1e1b4b] text-lg mb-2">AI Summary</h4>
          <p className="text-[#1e1b4b]/90 text-base leading-relaxed font-medium">
            {article.tldr}
          </p>
        </div>
      </div>

      {/* Key Takeaways */}
      <div className="mt-8">
        <h4 className="text-lg font-bold text-[#1e1b4b] mb-4">Breakdown for Beginners</h4>
        <div className="grid gap-4">
          {article.key_points.map((point, idx) => {
            // Parse the new format: "emoji **Title:** text"
            const match = point.match(/^(.*?)\*\*(.*?)\*\*(.*)$/);
            
            if (match) {
              return (
                <div key={idx} className="flex items-start gap-4 bg-slate-50 border border-slate-100 p-5 rounded-xl">
                  <div className="text-2xl shrink-0 bg-white w-10 h-10 rounded-full flex items-center justify-center shadow-sm border border-slate-200">
                    {match[1].trim()}
                  </div>
                  <div>
                    <h5 className="text-[#1e1b4b] font-bold text-base mb-1">{match[2].trim()}</h5>
                    <p className="text-slate-700 leading-relaxed text-base">{match[3].trim().replace(/^:\s*/, '')}</p>
                  </div>
                </div>
              );
            }
            
            // Fallback for older articles
            return (
              <div key={idx} className="flex items-start gap-4 text-base text-slate-700 pl-2">
                <span className="text-[#1e1b4b] font-bold mt-0.5">•</span>
                <span className="leading-relaxed">{point}</span>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Footer / Verification */}
      {article.faithfulness_score > 0.9 && (
        <div className="mt-8 pt-6 border-t border-slate-100 flex items-center gap-2 text-emerald-700 font-medium text-sm">
          <CheckCircle size={18} className="text-emerald-500" />
          Verified Summary
        </div>
      )}
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [configRes, articlesRes] = await Promise.all([
        fetch('/api/config-status'),
        fetch('/api/articles')
      ]);
      const configData = await configRes.json();
      const articlesData = await articlesRes.json();
      
      setConfig(configData);
      if (articlesData.articles) {
        setArticles(articlesData.articles);
      } else {
        setArticles([]);
        if (articlesData.error) {
          console.error("API Error:", articlesData.error);
        }
      }
    } catch (err) {
      console.error("Failed to fetch data", err);
    } finally {
      setLoading(false);
    }
  };

  const runPipeline = async () => {
    setTriggering(true);
    try {
      const secret = import.meta.env.VITE_CRON_SECRET || '';
      const res = await fetch('/api/trigger-pipeline', { 
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secret}`
        }
      });
      const data = await res.json();
      await fetchData();
      if (data.status === 'success') {
        alert(`Pipeline finished! Processed ${data.processed} articles. Added ${data.newArticlesAdded} new articles.`);
      } else {
        alert(`Pipeline failed: ${data.error}`);
      }
    } catch (err) {
      console.error("Pipeline failed", err);
      alert("Pipeline failed to run. Check console for details.");
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans selection:bg-[#e0e7ff]">
      {/* Header */}
      <header className="bg-transparent pt-6 pb-4">
        <div className="max-w-4xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="text-[#1e1b4b]" size={28} />
            <h1 className="text-2xl font-extrabold text-[#1e1b4b] tracking-tight">
              NeuralPulse
            </h1>
          </div>
          
          <button 
            onClick={runPipeline}
            disabled={triggering}
            className="bg-[#0f172a] text-white text-sm font-bold px-6 py-3 rounded-full hover:bg-[#1e293b] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-md"
          >
            {triggering ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
            <span>Run Pipeline</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        {config && !config.ready && <ConfigWarning />}

        {/* Hero Section matching PDF Page 1 */}
        <div className="mb-16 mt-4">
          <h2 className="text-4xl md:text-5xl font-extrabold text-[#1e1b4b] tracking-tight mb-6 leading-tight">
            NeuralPulse - Your AI-Powered<br/>News Assistant
          </h2>
          <p className="text-slate-600 text-lg max-w-3xl leading-relaxed">
            A complete intelligence feed for developers and data scientists who want instant access to frontier AI news. No more scrolling through endless feeds—get instant, accurate summaries with key takeaways directly from trusted sources.
          </p>
        </div>

        {/* Feed */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-400">
            <Loader2 className="animate-spin text-[#1e1b4b]" size={48} />
            <p className="text-base font-bold text-[#1e1b4b]">Fetching latest intelligence...</p>
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
            {articles.map(article => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
