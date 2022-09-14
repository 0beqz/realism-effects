uniform sampler2D accumulatedTexture;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 accumulatedTexel = texture2D(accumulatedTexture, vUv);

    outputColor = vec4(accumulatedTexel.rgb, 1.);
}