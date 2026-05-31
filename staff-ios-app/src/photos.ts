import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import type { PickedPhoto } from "./types";

const MAX_DIMENSION = 1800;

function filenameFromUri(uri: string, fallback = "task-photo.jpg") {
  const last = uri.split("/").pop()?.split("?")[0];
  if (!last) return fallback;
  return /\.(jpe?g|png|webp)$/i.test(last) ? last.replace(/\.(png|webp)$/i, ".jpg") : `${last}.jpg`;
}

export async function compressPickedAsset(asset: ImagePicker.ImagePickerAsset): Promise<PickedPhoto> {
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  const largerSide = Math.max(width, height);
  const resize =
    largerSide > MAX_DIMENSION
      ? width >= height
        ? { width: MAX_DIMENSION }
        : { height: MAX_DIMENSION }
      : {};

  const actions = Object.keys(resize).length > 0 ? [{ resize }] : [];
  const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
    compress: 0.74,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  return {
    uri: result.uri,
    name: filenameFromUri(asset.fileName || asset.uri),
    type: "image/jpeg",
  };
}

export async function pickPhotoFromLibrary() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return [];

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    quality: 1,
  });
  if (result.canceled) return [];
  return Promise.all(result.assets.map(compressPickedAsset));
}

export async function takePhotoWithCamera() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return [];

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    quality: 1,
  });
  if (result.canceled) return [];
  return Promise.all(result.assets.map(compressPickedAsset));
}
