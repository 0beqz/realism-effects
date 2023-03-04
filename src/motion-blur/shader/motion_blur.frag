uniform sampler2D inputTexture;
uniform sampler2D velocityTexture;
uniform sampler2D blueNoiseTexture;
uniform ivec2 blueNoiseSize;
uniform vec2 texSize;
uniform float intensity;
uniform float jitter;

uniform float deltaTime;
uniform int frame;

// source: https://www.shadertoy.com/view/wltcRS

// internal RNG state
uvec4 s0, s1;
ivec2 pixel;

void rng_initialize(vec2 p, int frame) {
    pixel = ivec2(p);

    // white noise seed
    s0 = uvec4(p, uint(frame), uint(p.x) + uint(p.y));

    // blue noise seed
    s1 = uvec4(frame, frame * 15843, frame * 31 + 4566, frame * 2345 + 58585);
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

// random blue noise sampling pos
ivec2 shift2() {
    pcg4d(s1);
    return (pixel + ivec2(s1.xy % 0x0fffffffu)) % blueNoiseSize;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 velocity = textureLod(velocityTexture, vUv, 0.0);

    if (dot(velocity.xyz, velocity.xyz) == 0.0) {
        outputColor = inputColor;
        return;
    }

    velocity.xy *= intensity;

    rng_initialize(vUv * texSize, frame);

    vec2 blueNoise = texelFetch(blueNoiseTexture, shift2(), 0).rg - 0.5;

    vec2 jitterOffset = jitter * velocity.xy * blueNoise;

    // UVs will be centered around the target pixel (see http://john-chapman-graphics.blogspot.com/2013/01/per-object-motion-blur.html)
    vec2 startUv = vUv + jitterOffset - velocity.xy * 0.5;
    vec2 endUv = vUv + jitterOffset + velocity.xy * 0.5;

    startUv = max(vec2(0.), startUv);
    endUv = min(vec2(1.), endUv);

    vec3 motionBlurredColor;
    for (float i = 0.0; i <= samplesFloat; i++) {
        vec2 reprojectedUv = mix(startUv, endUv, i / samplesFloat);
        vec3 neighborColor = textureLod(inputTexture, reprojectedUv, 0.0).rgb;

        motionBlurredColor += neighborColor;
    }

    motionBlurredColor /= samplesFloat;

    outputColor = vec4(motionBlurredColor, inputColor.a);
}