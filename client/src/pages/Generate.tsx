import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Sparkles, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function Generate() {
  const { user, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);

  // Check quota
  const { data: quotaData } = trpc.image.checkQuota.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Generate image mutation
  const generateMutation = trpc.image.generate.useMutation({
    onSuccess: (data) => {
      setGeneratedImage(data.imageUrl || null);
      setPrompt("");
      setIsGenerating(false);
      toast.success("Image generated successfully!");
    },
    onError: (error) => {
      setIsGenerating(false);
      toast.error(error.message || "Failed to generate image");
    },
  });

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <Card className="p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Sign In Required</h2>
          <p className="text-slate-600 mb-4">Please sign in to generate images.</p>
          <Button onClick={() => setLocation("/")} className="bg-blue-600 hover:bg-blue-700">
            Go Home
          </Button>
        </Card>
      </div>
    );
  }

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!prompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }

    if (!quotaData?.canGenerate) {
      toast.error("You have reached your daily limit. Try again tomorrow!");
      return;
    }

    setIsGenerating(true);
    await generateMutation.mutateAsync({ prompt });
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <Card className="p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Sign In Required</h2>
          <p className="text-slate-600 mb-4">Please sign in to generate images.</p>
          <Button onClick={() => setLocation("/")} className="bg-blue-600 hover:bg-blue-700">
            Go Home
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-12">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Generate Your Image</h1>
          <p className="text-lg text-slate-600">
            Describe what you want to create and let AI bring it to life
          </p>
        </div>

        {/* Quota Status */}
        <Card className="mb-8 p-6 border-l-4 border-l-blue-600">
          <div className="flex items-center gap-3">
            {quotaData?.canGenerate ? (
              <>
                <CheckCircle className="w-6 h-6 text-green-600" />
                <div>
                  <p className="font-bold text-slate-900">You have 1 image available today</p>
                  <p className="text-sm text-slate-600">Resets at midnight UTC</p>
                </div>
              </>
            ) : (
              <>
                <AlertCircle className="w-6 h-6 text-red-600" />
                <div>
                  <p className="font-bold text-slate-900">Daily limit reached</p>
                  <p className="text-sm text-slate-600">Come back tomorrow for more</p>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Generation Form */}
        {quotaData?.canGenerate && (
          <Card className="p-8 mb-8">
            <form onSubmit={handleGenerate}>
              <div className="mb-6">
                <label className="block text-sm font-bold text-slate-900 mb-2">
                  Your Prompt
                </label>
                <Textarea
                  placeholder="Describe the image you want to create. Be as detailed as possible..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={isGenerating}
                  className="min-h-32 resize-none"
                />
                <p className="text-xs text-slate-500 mt-2">
                  {prompt.length}/500 characters
                </p>
              </div>

              <Button
                type="submit"
                disabled={isGenerating || !prompt.trim()}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                size="lg"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Image
                  </>
                )}
              </Button>
            </form>
          </Card>
        )}

        {/* Generated Image Display */}
        {generatedImage && (
          <Card className="p-8 text-center">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Your Generated Image</h2>
            <div className="mb-6 rounded-lg overflow-hidden bg-slate-200">
              <img
                src={generatedImage}
                alt="Generated"
                className="w-full h-auto max-h-96 object-cover"
              />
            </div>
            <div className="flex gap-4 justify-center">
              <Button
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = generatedImage;
                  a.download = `leaderbot-${Date.now()}.png`;
                  a.click();
                }}
                className="bg-green-600 hover:bg-green-700"
              >
                Download Image
              </Button>
              <Button
                onClick={() => setLocation("/gallery")}
                variant="outline"
              >
                View Gallery
              </Button>
            </div>
          </Card>
        )}

        {/* Tips Section */}
        <Card className="mt-12 p-6 bg-blue-50 border-blue-200">
          <h3 className="font-bold text-slate-900 mb-3">💡 Tips for Better Results</h3>
          <ul className="text-slate-700 space-y-2 text-sm">
            <li>• Be specific about what you want (e.g., "oil painting" vs just "painting")</li>
            <li>• Include style references (e.g., "in the style of Van Gogh")</li>
            <li>• Describe colors, lighting, and mood</li>
            <li>• Mention the medium (photo, illustration, 3D render, etc.)</li>
            <li>• Longer, more detailed prompts usually produce better results</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
