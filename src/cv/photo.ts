export const ACCEPTED_PHOTO_TYPES = "image/jpeg,image/png,image/webp,image/heic";

/** Center-crops the image to a square and shrinks it to `size` px as JPEG, so the stored data URL stays ~30 KB. */
export async function photoToDataUrl(file: File, size = 400): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("No se pudo leer la imagen. Use una foto JPG o PNG.");
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}
