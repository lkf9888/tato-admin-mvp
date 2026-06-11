"use client";

import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc ||= new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

const pdfCache = new Map<string, Promise<PDFDocumentProxy>>();

function loadPdf(url: string) {
  let cached = pdfCache.get(url);
  if (!cached) {
    cached = pdfjs.getDocument({ url, withCredentials: true }).promise;
    pdfCache.set(url, cached);
  }
  return cached;
}

function isRenderCancelled(error: unknown) {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

export function PdfPageCanvas({
  url,
  pageNumber,
  className = "",
}: {
  url: string;
  pageNumber: number;
  className?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setSize({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!url || !pageNumber || size.width <= 0 || size.height <= 0) return;
    let cancelled = false;

    async function renderPage() {
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      setFailed(false);

      try {
        const pdf = await loadPdf(url);
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(
          size.width / baseViewport.width,
          size.height / baseViewport.height,
        );
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;

        const outputScale = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
        context.clearRect(0, 0, viewport.width, viewport.height);

        const task = page.render({ canvasContext: context, viewport });
        renderTaskRef.current = task;
        await task.promise;
        if (renderTaskRef.current === task) {
          renderTaskRef.current = null;
        }
      } catch (error) {
        if (!cancelled && !isRenderCancelled(error)) {
          setFailed(true);
        }
      }
    }

    void renderPage();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [url, pageNumber, size.width, size.height]);

  return (
    <div ref={wrapperRef} className={className} aria-hidden="true">
      <canvas ref={canvasRef} className="h-full w-full bg-white" />
      {failed ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white text-xs text-neutral-500">
          PDF 预览加载失败
        </div>
      ) : null}
    </div>
  );
}
