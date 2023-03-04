uniform sampler2D inputTexture;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 accumulatedTexel = textureLod(inputTexture, vUv, 0.);

    outputColor = vec4(accumulatedTexel.rgb, 1.);
}