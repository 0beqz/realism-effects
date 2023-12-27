uniform sampler2D inputTexture;
uniform highp sampler2D velocityTexture;
uniform vec2 resolution;
uniform float intensity;
uniform float jitter;

uniform float deltaTime;
uniform int frame;
uniform vec2 texSize;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 velocity = textureLod(velocityTexture, vUv, 0.0).xy;
  bool didMove = dot(velocity, velocity) > 0.000000001;

  if (!didMove) {
    outputColor = inputColor;
    return;
  }

  velocity *= intensity;

  vec4 blueNoise = blueNoise(vUv, frame);
  vec2 jitterOffset = jitter * velocity * blueNoise.xy;
  float frameSpeed = (1. / 100.) / deltaTime;

  // UVs will be centered around the target pixel (see
  // http://john-chapman-graphics.blogspot.com/2013/01/per-object-motion-blur.html)
  vec2 startUv = vUv + (jitterOffset - velocity * 0.5) * frameSpeed;
  vec2 endUv = vUv + (jitterOffset + velocity * 0.5) * frameSpeed;

  startUv = max(vec2(0.), startUv);
  endUv = min(vec2(1.), endUv);

  vec3 motionBlurredColor = inputColor.rgb;
  for (float i = 0.0; i <= samplesFloat; i++) {
    vec2 reprojectedUv = mix(startUv, endUv, i / samplesFloat);
    vec3 neighborColor = textureLod(inputTexture, reprojectedUv, 0.0).rgb;

    motionBlurredColor += neighborColor;
  }

  motionBlurredColor /= samplesFloat + 2.;

  outputColor = vec4(motionBlurredColor, inputColor.a);
}