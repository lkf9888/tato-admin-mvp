const IMAGE_MAX_DIMENSION = 2200;
const IMAGE_TARGET_BYTES = 1_200_000;
const IMAGE_QUALITY_STEPS = [0.82, 0.74, 0.66, 0.58];

export async function compressImageFiles(files: File[]) {
  const compressed = await Promise.all(files.map((file) => compressImageFile(file)));
  return compressed;
}

async function compressImageFile(file: File): Promise<File> {
  if (!shouldCompressImage(file)) return file;

  try {
    const image = await loadImage(file);
    const { width, height } = fitDimensions(image.width, image.height, IMAGE_MAX_DIMENSION);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return file;

    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const quality of IMAGE_QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (!blob) continue;
      if (blob.size < file.size || blob.size <= IMAGE_TARGET_BYTES) {
        return new File([blob], toJpegFilename(file.name), {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
      }
    }
  } catch {
    return file;
  }

  return file;
}

function shouldCompressImage(file: File) {
  const name = file.name.toLowerCase();
  if (!isCompressibleImage(file.type, name)) return false;
  return file.size > 350_000;
}

function isCompressibleImage(type: string, name: string) {
  if (type === "image/jpeg" || type === "image/png" || type === "image/webp") return true;
  return /\.(jpe?g|png|webp)$/i.test(name);
}

function fitDimensions(width: number, height: number, maxDimension: number) {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function toJpegFilename(filename: string) {
  const withoutExtension = filename.replace(/\.[^.]+$/, "");
  return `${withoutExtension || "photo"}.jpg`;
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("IMAGE_LOAD_FAILED"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}
