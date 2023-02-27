
uniform sampler2D inputTexture;
uniform sampler2D velocityTexture;
uniform sampler2D blueNoiseTexture;
uniform vec2 blueNoiseRepeat;
uniform vec2 invTexSize;
uniform float intensity;
uniform float jitter;

uniform float deltaTime;
uniform float frames;

const float gr = 1.618033988749895;

const vec2 blueNoiseSeed = vec2(
    1. / gr,
    1. / pow(gr, 1. / 2.));

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 velocity = textureLod(velocityTexture, vUv, 0.0);

    if (dot(velocity.xyz, velocity.xyz) == 0.0) {
        outputColor = inputColor;
        return;
    }

    velocity.xy *= intensity;

    vec2 blueNoise = textureLod(blueNoiseTexture, vUv * blueNoiseRepeat, 0.).rg;

    blueNoise = fract(blueNoise + blueNoiseSeed * frames);

    vec2 jitterOffset = jitter * velocity.xy * blueNoise;

    // UVs will be centered around the target pixel (see http://john-chapman-graphics.blogspot.com/2013/01/per-object-motion-blur.html)
    vec2 startUv = vUv + jitterOffset - velocity.xy * 0.5;
    vec2 endUv = vUv + jitterOffset + velocity.xy * 0.5;

    startUv = max(vec2(0.), startUv);
    endUv = min(vec2(1.), endUv);

    float samplesMinus1Float = samplesFloat - 1.0;

    vec3 motionBlurredColor;
    for (int i = 1; i < samples; i++) {
        vec2 reprojectedUv = mix(startUv, endUv, float(i) / samplesMinus1Float);
        vec3 neighborColor = textureLod(inputTexture, reprojectedUv, 0.0).rgb;

        motionBlurredColor += neighborColor;
    }

    motionBlurredColor /= samplesFloat;

    outputColor = vec4(motionBlurredColor, inputColor.a);
}