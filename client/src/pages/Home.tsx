import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { Sparkles, Image as ImageIcon, BarChart3 } from "lucide-react";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="text-center">
          <div className="animate-spin mb-4">
            <Sparkles className="w-12 h-12 text-blue-600" />
          </div>
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4">
        <div className="max-w-md text-center">
          <div className="mb-6">
            <Sparkles className="w-16 h-16 text-blue-600 mx-auto" />
          </div>
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Leaderbot</h1>
          <p className="text-lg text-slate-600 mb-8">
            Generate stunning AI images with just a text prompt. One free image per day!
          </p>
          <a href={getLoginUrl()}>
            <Button size="lg" className="w-full bg-blue-600 hover:bg-blue-700">
              Sign In with Manus
            </Button>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-8 h-8 text-blue-600" />
            <h1 className="text-2xl font-bold text-slate-900">Leaderbot</h1>
          </div>
          <nav className="flex items-center gap-4">
            <button
              onClick={() => setLocation("/generate")}
              className="text-slate-700 hover:text-blue-600 font-medium transition"
            >
              Generate
            </button>
            <button
              onClick={() => setLocation("/gallery")}
              className="text-slate-700 hover:text-blue-600 font-medium transition"
            >
              Gallery
            </button>
            {user?.role === "admin" && (
              <button
                onClick={() => setLocation("/admin")}
                className="text-slate-700 hover:text-blue-600 font-medium transition"
              >
                Admin
              </button>
            )}
            <button
              onClick={() => setLocation("/profile")}
              className="text-slate-700 hover:text-blue-600 font-medium transition"
            >
              Profile
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-slate-900 mb-3">
            Welcome, {user?.name || "User"}!
          </h2>
          <p className="text-lg text-slate-600">
            Create beautiful AI-generated images from text prompts
          </p>
        </div>

        {/* Feature Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {/* Generate Card */}
          <div className="bg-white rounded-lg border border-slate-200 p-6 hover:shadow-lg transition">
            <ImageIcon className="w-12 h-12 text-blue-600 mb-4" />
            <h3 className="text-xl font-bold text-slate-900 mb-2">Generate Images</h3>
            <p className="text-slate-600 mb-4">
              Describe your vision and let AI create stunning images for you.
            </p>
            <Button
              onClick={() => setLocation("/generate")}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              Start Generating
            </Button>
          </div>

          {/* Gallery Card */}
          <div className="bg-white rounded-lg border border-slate-200 p-6 hover:shadow-lg transition">
            <ImageIcon className="w-12 h-12 text-purple-600 mb-4" />
            <h3 className="text-xl font-bold text-slate-900 mb-2">View Gallery</h3>
            <p className="text-slate-600 mb-4">
              Explore images created by the community. Get inspired by others' creations.
            </p>
            <Button
              onClick={() => setLocation("/gallery")}
              variant="outline"
              className="w-full"
            >
              Browse Gallery
            </Button>
          </div>

          {/* Admin Card */}
          {user?.role === "admin" && (
            <div className="bg-white rounded-lg border border-slate-200 p-6 hover:shadow-lg transition">
              <BarChart3 className="w-12 h-12 text-green-600 mb-4" />
              <h3 className="text-xl font-bold text-slate-900 mb-2">Admin Dashboard</h3>
              <p className="text-slate-600 mb-4">
                Monitor usage statistics and system health.
              </p>
              <Button
                onClick={() => setLocation("/admin")}
                variant="outline"
                className="w-full"
              >
                View Dashboard
              </Button>
            </div>
          )}
        </div>

        {/* Info Section */}
        <div className="bg-white rounded-lg border border-slate-200 p-8">
          <h3 className="text-2xl font-bold text-slate-900 mb-4">How It Works</h3>
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <div className="text-3xl font-bold text-blue-600 mb-2">1</div>
              <h4 className="font-bold text-slate-900 mb-2">Write Your Prompt</h4>
              <p className="text-slate-600">
                Describe the image you want to create in detail. Be creative!
              </p>
            </div>
            <div>
              <div className="text-3xl font-bold text-blue-600 mb-2">2</div>
              <h4 className="font-bold text-slate-900 mb-2">AI Creates Magic</h4>
              <p className="text-slate-600">
                Our advanced AI generates a high-quality image based on your description.
              </p>
            </div>
            <div>
              <div className="text-3xl font-bold text-blue-600 mb-2">3</div>
              <h4 className="font-bold text-slate-900 mb-2">Share & Enjoy</h4>
              <p className="text-slate-600">
                View your creation in the gallery and share with the community.
              </p>
            </div>
          </div>
        </div>

        {/* Daily Limit Info */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <p className="text-blue-900">
            <strong>Daily Limit:</strong> You can generate one free image per 24-hour period. Use it wisely!
          </p>
        </div>
      </main>
    </div>
  );
}
