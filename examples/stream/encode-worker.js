// Example: use a separate on-demand worker for saves/exports.
self.onmessage = async ({ data: input }) => {
  try {
    const { encode } = await import('../../dist/encode.js');
    // Store mode delegates HTTP compression to the CDN. For compact downloads,
    // import gzipCodec from /codecs here and pass { codec: gzipCodec }.
    const bytes = await encode(input);
    self.postMessage({ bytes }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
