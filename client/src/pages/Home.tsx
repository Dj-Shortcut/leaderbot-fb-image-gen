import { Sparkles } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="mb-6">
          <Sparkles className="w-16 h-16 text-blue-600 mx-auto" />
        </div>
        <h1 className="text-4xl font-bold text-slate-900 mb-2">Leaderbot</h1>
        <p className="text-lg text-slate-600 mb-8">
          Transform your photos with AI styles. Message us on Facebook to get started!
        </p>
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-xl font-bold text-slate-900 mb-4">How to Use</h2>
          <ol className="text-left text-slate-600 space-y-2">
            <li><strong>1.</strong> Send a photo on Messenger</li>
            <li><strong>2.</strong> Pick a style (Disco, Anime, Gold, etc.)</li>
            <li><strong>3.</strong> Get your transformed image</li>
            <li><strong>4.</strong> One free image per day!</li>
          </ol>
        </div>
        <p className="text-sm text-slate-500 mt-6">
          Find us on Facebook and start transforming your photos today.
        </p>
      </div>
    </div>
  );
}
