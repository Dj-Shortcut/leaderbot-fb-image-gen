import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, BarChart3, Loader2, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";

export default function Admin() {
  const { user, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  // Fetch admin stats
  const { data: stats, isLoading: statsLoading } = trpc.admin.getStats.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
  });

  // Fetch notifications
  const { data: notifications, isLoading: notificationsLoading } = trpc.admin.getNotifications.useQuery(
    { limit: 20 },
    { enabled: isAuthenticated && user?.role === "admin" }
  );

  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <Card className="p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h2>
          <p className="text-slate-600 mb-4">Only admins can access this page.</p>
          <Button onClick={() => setLocation("/")} className="bg-blue-600 hover:bg-blue-700">
            Go Home
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-12">
      <div className="max-w-7xl mx-auto px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 mb-2">Admin Dashboard</h1>
            <p className="text-lg text-slate-600">Monitor system usage and health</p>
          </div>
          <Button onClick={() => setLocation("/")} variant="outline">
            ← Back
          </Button>
        </div>

        {/* Statistics Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          {/* Total Images Generated */}
          <Card className="p-6 border-l-4 border-l-blue-600">
            {statsLoading ? (
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            ) : (
              <>
                <p className="text-sm text-slate-600 mb-2">Total Images Generated Today</p>
                <p className="text-4xl font-bold text-slate-900">
                  {stats?.totalImagesGenerated || 0}
                </p>
              </>
            )}
          </Card>

          {/* Active Users */}
          <Card className="p-6 border-l-4 border-l-green-600">
            {statsLoading ? (
              <Loader2 className="w-8 h-8 animate-spin text-green-600" />
            ) : (
              <>
                <p className="text-sm text-slate-600 mb-2">Active Users Today</p>
                <p className="text-4xl font-bold text-slate-900">
                  {stats?.totalUsersActive || 0}
                </p>
              </>
            )}
          </Card>

          {/* Failed Requests */}
          <Card className="p-6 border-l-4 border-l-red-600">
            {statsLoading ? (
              <Loader2 className="w-8 h-8 animate-spin text-red-600" />
            ) : (
              <>
                <p className="text-sm text-slate-600 mb-2">Failed Requests Today</p>
                <p className="text-4xl font-bold text-slate-900">
                  {stats?.totalFailedRequests || 0}
                </p>
              </>
            )}
          </Card>
        </div>

        {/* Notifications Log */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-6">
            <AlertTriangle className="w-6 h-6 text-slate-700" />
            <h2 className="text-2xl font-bold text-slate-900">Recent Notifications</h2>
          </div>

          {notificationsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : notifications && notifications.length > 0 ? (
            <div className="space-y-4">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`p-4 rounded-lg border-l-4 ${
                    notification.type === "error"
                      ? "bg-red-50 border-l-red-600"
                      : notification.type === "milestone"
                      ? "bg-green-50 border-l-green-600"
                      : notification.type === "quota_warning"
                      ? "bg-yellow-50 border-l-yellow-600"
                      : "bg-blue-50 border-l-blue-600"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-bold text-slate-900">{notification.title}</p>
                      <p className="text-sm text-slate-700 mt-1">{notification.content}</p>
                    </div>
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        notification.sent
                          ? "bg-green-200 text-green-800"
                          : "bg-red-200 text-red-800"
                      }`}
                    >
                      {notification.sent ? "Sent" : "Failed"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    {new Date(notification.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-slate-600 py-8">No notifications yet</p>
          )}
        </Card>

        {/* System Info */}
        <Card className="mt-8 p-6 bg-blue-50 border-blue-200">
          <h3 className="font-bold text-slate-900 mb-3">ℹ️ System Information</h3>
          <ul className="text-slate-700 space-y-2 text-sm">
            <li>• Daily quota resets at midnight UTC</li>
            <li>• Each user can generate 1 free image per 24-hour period</li>
            <li>• Owner notifications sent on milestones (every 10 images)</li>
            <li>• All generated images are stored with user attribution</li>
            <li>• Failed requests are logged for troubleshooting</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
