import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, LogOut, Image as ImageIcon } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function Profile() {
  const { user, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  // Check quota
  const { data: quotaData } = trpc.image.checkQuota.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Get user's images
  const { data: userImages, isLoading } = trpc.image.getUserImages.useQuery(
    { limit: 10, offset: 0 },
    { enabled: isAuthenticated }
  );

  // Logout mutation
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      toast.success("Logged out successfully");
      setLocation("/");
    },
  });

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <Card className="p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Sign In Required</h2>
          <p className="text-slate-600 mb-4">Please sign in to view your profile.</p>
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
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 mb-2">Your Profile</h1>
            <p className="text-lg text-slate-600">Manage your account and view your creations</p>
          </div>
          <Button onClick={() => setLocation("/")} variant="outline">
            ← Back
          </Button>
        </div>

        {/* User Info Card */}
        <Card className="p-8 mb-8">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">{user?.name || "User"}</h2>
              <p className="text-slate-600">{user?.email || "No email"}</p>
              <p className="text-sm text-slate-500 mt-2">
                Member since {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : ""}
              </p>
            </div>
            <Button
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              variant="outline"
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              {logoutMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Logging out...
                </>
              ) : (
                <>
                  <LogOut className="w-4 h-4 mr-2" />
                  Logout
                </>
              )}
            </Button>
          </div>

          {/* Role Badge */}
          {user?.role === "admin" && (
            <div className="inline-block bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm font-bold">
              Admin
            </div>
          )}
        </Card>

        {/* Quota Status */}
        <Card className="p-6 mb-8 border-l-4 border-l-blue-600">
          <h3 className="text-xl font-bold text-slate-900 mb-4">Daily Quota Status</h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-600 mb-2">Images available today</p>
              <p className="text-4xl font-bold text-blue-600">
                {quotaData?.canGenerate ? "1" : "0"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-600 mb-2">Status</p>
              <p
                className={`text-lg font-bold ${
                  quotaData?.canGenerate ? "text-green-600" : "text-red-600"
                }`}
              >
                {quotaData?.canGenerate ? "Available" : "Used"}
              </p>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-4">Resets at midnight UTC</p>
        </Card>

        {/* Your Images */}
        <Card className="p-6">
          <h3 className="text-xl font-bold text-slate-900 mb-4">Your Generated Images</h3>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : userImages && userImages.length > 0 ? (
            <div className="space-y-4">
              {userImages.map((image) => (
                <div
                  key={image.id}
                  className="flex gap-4 p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition"
                >
                  {image.imageUrl && (
                    <div className="w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-slate-200">
                      <img
                        src={image.imageUrl}
                        alt={image.prompt}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-bold text-slate-900 mb-1">{image.prompt}</p>
                    <p className="text-sm text-slate-600 mb-2">
                      {new Date(image.createdAt).toLocaleString()}
                    </p>
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        image.status === "completed"
                          ? "bg-green-100 text-green-800"
                          : image.status === "failed"
                          ? "bg-red-100 text-red-800"
                          : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {image.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <ImageIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600 mb-4">No images generated yet</p>
              <Button
                onClick={() => setLocation("/generate")}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Generate Your First Image
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
