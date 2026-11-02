'use strict';

function createBoundedHeifDecoder(libheif, maxImages) {
  let context = null;

  function releaseContext() {
    if (context) libheif.heif_context_free(context);
    context = null;
  }

  return Object.freeze({
    decode(bytes) {
      releaseContext();
      context = libheif.heif_context_alloc();
      if (!context) throw new Error('HEIC/HEIF 디코더 메모리를 준비하지 못했습니다.');

      const result = libheif.heif_context_read_from_memory(context, bytes);
      if (result.code !== libheif.heif_error_code.heif_error_Ok) return [];

      // This count query runs before libheif-js materializes the JavaScript
      // array of image IDs and allocates an image handle for every entry.
      const count = libheif.heif_context_get_number_of_top_level_images(context);
      if (!Number.isSafeInteger(count) || count < 0 || count > maxImages) {
        releaseContext();
        throw new Error(`HEIC/HEIF 이미지가 안전 한도(${maxImages}장)를 넘었습니다.`);
      }
      if (count === 0) return [];

      const ids = libheif.heif_js_context_get_list_of_top_level_image_IDs(context);
      if (!Array.isArray(ids) || ids.code || ids.length !== count) {
        throw new Error('HEIC/HEIF 이미지 목록을 안전하게 읽지 못했습니다.');
      }

      const images = [];
      try {
        for (const id of ids) {
          const handle = libheif.heif_js_context_get_image_handle(context, id);
          if (!handle || handle.code) continue;
          images.push(new libheif.HeifImage(handle));
        }
        return images;
      } catch (error) {
        for (const image of images) image.free();
        releaseContext();
        throw error;
      }
    },
    dispose() {
      releaseContext();
    },
  });
}

module.exports = { createBoundedHeifDecoder };
