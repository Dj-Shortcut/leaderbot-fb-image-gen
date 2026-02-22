import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Image as ImageIcon } from "lucide-react";
import { useLocation } from "wouter";

export default function Gallery() {
  const [, setLocation] = useLocation();
  const [offset, setOffset] = useState(0);
  const limit = 12;

  // Fetch gallery images
  const { data: images, isLoading } = trpc.image.getGallery.useQuery({
    limit,
    offset,
  });

  const handleLoadMore = () => {
    setOffset(offset + limit);
  };

  const handleLoadPrevious = () => {
    if (offset >= limit) {
      setOffset(offset - limit);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-12">
      <div className="max-w-7xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Image Gallery</h1>
          <p className="text-lg text-slate-600">
            Explore stunning AI-generated images from our community
          </p>
        </div>

        {/* Navigation */}
        <div className="mb-8 flex justify-between items-center">
          <Button
            onClick={() => setLocation("/")}
            variant="outline"
          >
            ← Back Home
          </Button>
          <Button
            onClick={() => setLocation("/generate")}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Generate Your Own
          </Button>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        )}

        {/* Images Grid */}
        {!isLoading && images && images.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {images.map((image) => (
                <Card key={image.id} className="overflow-hidden hover:shadow-lg transition">
                  <div className="aspect-square bg-slate-200 overflow-hidden">
                    <img
                      src={image.imageUrl || ""}
                      alt={image.prompt}
                      className="w-full h-full object-cover hover:scale-105 transition"
                    />
                  </div>
                  <div className="p-4">
                    <p className="text-sm text-slate-600 mb-2 line-clamp-2">
                      {image.prompt}
                    </p>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>by {image.userName || "Anonymous"}</span>
                      <span>
                        {image.createdAt
                          ? new Date(image.createdAt).toLocaleDateString()
                          : ""}
                      </span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex justify-center gap-4">
              <Button
                onClick={handleLoadPrevious}
                disabled={offset === 0}
                variant="outline"
              >
                ← Previous
              </Button>
              <Button
                onClick={handleLoadMore}
                disabled={!images || images.length < limit}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Next →
              </Button>
            </div>
          </>
        ) : (
          <Card className="p-12 text-center">
            <ImageIcon className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">No Images Yet</h2>
            <p className="text-slate-600 mb-6">
              Be the first to generate an image!
            </p>
            <Button
              onClick={() => setLocation("/generate")}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Generate Your First Image
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
