
uniform sampler2D inputTexture;
uniform sampler2D velocityTexture;
uniform sampler2D blueNoiseTexture;
uniform vec2 blueNoiseRepeat;
uniform float intensity;
uniform float jitter;
uniform int seed;
uniform float deltaTime;

// from: https://github.com/gkjohnson/three-gpu-pathtracer/blob/5c74583ce4e246b5a582cc8fe974051064978207/src/shader/shaderUtils.js
// https://www.shadertoy.com/view/wltcRS
uvec4 s0;
void rng_initialize(vec2 p, int frame) {
    // white noise seed
    s0 = uvec4(p, uint(frame), uint(p.x) + uint(p.y));
}
// https://www.pcg-random.org/
void pcg4d(inout uvec4 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.w;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v.w += v.y * v.z;
    v = v ^ (v >> 16u);
    v.x += v.y * v.w;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v.w += v.y * v.z;
}

// returns [ 0, 1 ]
float rand() {
    pcg4d(s0);
    return float(s0.x) / float(0xffffffffu);
}

vec2 rand2() {
    pcg4d(s0);
    return vec2(s0.xy) / float(0xffffffffu);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 velocity = textureLod(velocityTexture, vUv, 0.0);

    // skip background
    if (dot(velocity.xyz, velocity.xyz) == 0.0) {
        outputColor = inputColor;
        return;
    }

    rng_initialize(vUv, seed);

    // unpack velocity [0, 1] -> [-1, 1]
    velocity.xy = unpackRGBATo2Half(velocity) * 2. - 1.;

    velocity.xy *= intensity / (60. * deltaTime);

    vec2 blueNoiseUv = (vUv + rand2()) * blueNoiseRepeat;
    vec2 blueNoise = textureLod(blueNoiseTexture, blueNoiseUv, 0.).rg;

    vec3 motionBlurredColor;
    vec3 neighborColor;
    vec2 reprojectedUv;

    vec2 jitterOffset = jitter * velocity.xy * blueNoise / samplesFloat;

    // UVs will be centered around the target pixel (see http://john-chapman-graphics.blogspot.com/2013/01/per-object-motion-blur.html)
    vec2 startUv = vUv - velocity.xy * 0.5;
    vec2 endUv = vUv + velocity.xy * 0.5 + jitterOffset;

    startUv = max(vec2(0.), startUv);
    endUv = min(vec2(1.), endUv);

    for (int i = 0; i < samples; i++) {
        if (i == samples) {
            neighborColor = inputColor.rgb;
        } else {
            reprojectedUv = mix(startUv, endUv, float(i) / samplesFloat);
            neighborColor = textureLod(inputTexture, reprojectedUv, 0.0).rgb;
        }

        motionBlurredColor += neighborColor;
    }

    motionBlurredColor /= samplesFloat;

    outputColor = vec4(motionBlurredColor, inputColor.a);
}