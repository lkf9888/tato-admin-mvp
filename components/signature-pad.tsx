"use client";

import { useEffect, useRef, type PointerEvent } from "react";

/**
 * A drawn signature, as a PNG data URL ("" when empty). Shared by the
 * contract signing page and the booking page, where the renter signs
 * the rental agreement before paying.
 */
export function SignaturePad({
  value,
  onChange,
  compact = false,
  disabled = false,
  clearLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
  disabled?: boolean;
  clearLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!value) return;
    const image = new Image();
    image.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = value;
  }, [value]);

  function pointerPosition(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const canvas = event.currentTarget;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    canvas.setPointerCapture(event.pointerId);
    const point = pointerPosition(event);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    const canvas = event.currentTarget;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const point = pointerPosition(event);
    ctx.lineTo(point.x, point.y);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111827";
    ctx.stroke();
    onChange(canvas.toDataURL("image/png"));
  }

  function end(event: PointerEvent<HTMLCanvasElement>) {
    drawing.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function clear() {
    if (disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  }

  return (
    <div className={compact ? "relative h-full w-full" : "mt-2"}>
      <canvas
        ref={canvasRef}
        width={520}
        height={180}
        className={
          compact
            ? "h-full w-full touch-none rounded border border-[var(--line-strong)] bg-white disabled:opacity-70"
            : "h-32 w-full touch-none rounded-lg border border-[var(--line-strong)] bg-white"
        }
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <button
        type="button"
        className={
          compact
            ? "absolute bottom-1 right-1 rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ink-mid)] shadow"
            : "mt-2 text-sm text-[var(--ink-soft)] underline"
        }
        onClick={clear}
        disabled={disabled}
      >
        {clearLabel}
      </button>
    </div>
  );
}
