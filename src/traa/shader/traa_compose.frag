uniform sampler2D inputTexture;
uniform sampler2D velocityTexture;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float depth = textureLod(velocityTexture, uv, 0.).a;
  if (depth == 1.0) {
    outputColor = inputColor;
    return;
  }

  vec4 accumulatedTexel = linearToOutputTexel(textureLod(inputTexture, vUv, 0.));

  outputColor = vec4(accumulatedTexel.rgb, 1.);
}