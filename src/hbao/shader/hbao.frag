varying vec2 vUv;

#include <packing>

uniform sampler2D depthTexture;
uniform float cameraNear;
uniform float cameraFar;
uniform mat4 projectionMatrix;
uniform mat4 inverseProjectionMatrix;
uniform mat4 projectionViewMatrix;
uniform int frame;

uniform sampler2D blueNoiseTexture;
uniform vec2 blueNoiseRepeat;
uniform vec2 texSize;

uniform float scale;
uniform float scalePower;
uniform float bias;
uniform float thickness;
uniform float power;

#define TWO_PI 6.28318530717958647692528676655900576
#define PI     3.14159265358979323846264338327950288

// source: https://github.com/mrdoob/three.js/blob/342946c8392639028da439b6dc0597e58209c696/examples/js/shaders/SAOShader.js#L123
float getViewZ(const float depth) {
#ifdef PERSPECTIVE_CAMERA
    return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
#else
    return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
#endif
}

const float g = 1.6180339887498948482;
const float a1 = 1.0 / g;

// reference: https://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/
float r1(float n) {
    // 7th harmonious number
    return fract(1.1127756842787055 + a1 * n);
}

const vec4 hn = vec4(0.618033988749895, 0.3247179572447458, 0.2207440846057596, 0.1673039782614187);

vec4 sampleBlueNoise(int seed) {
    vec2 size = vUv * texSize;
    vec2 blueNoiseSize = texSize / blueNoiseRepeat;
    float blueNoiseIndex = floor(floor(size.y / blueNoiseSize.y) * blueNoiseRepeat.x) + floor(size.x / blueNoiseSize.x);

    // get the offset of this pixel's blue noise tile
    int blueNoiseTileOffset = int(r1(blueNoiseIndex + 1.0) * 65536.);

    vec2 blueNoiseUv = vUv * blueNoiseRepeat;

    // fetch blue noise for this pixel
    vec4 blueNoise = textureLod(blueNoiseTexture, blueNoiseUv, 0.);

    // animate blue noise
    blueNoise = fract(blueNoise + hn * float(seed + blueNoiseTileOffset));

    blueNoise.r = (blueNoise.r > 0.5 ? 1.0 - blueNoise.r : blueNoise.r) * 2.0;
    blueNoise.g = (blueNoise.g > 0.5 ? 1.0 - blueNoise.g : blueNoise.g) * 2.0;
    blueNoise.b = (blueNoise.b > 0.5 ? 1.0 - blueNoise.b : blueNoise.b) * 2.0;
    blueNoise.a = (blueNoise.a > 0.5 ? 1.0 - blueNoise.a : blueNoise.a) * 2.0;

    return blueNoise;
}

// source: https://github.com/N8python/ssao/blob/master/EffectShader.js#L52
vec3 getWorldPos(float depth, vec2 coord) {
    float z = depth * 2.0 - 1.0;
    vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
    vec4 viewSpacePosition = inverseProjectionMatrix * clipSpacePosition;
    // Perspective division
    vec4 worldSpacePosition = inverse(viewMatrix) * viewSpacePosition;
    worldSpacePosition.xyz /= worldSpacePosition.w;
    return worldSpacePosition.xyz;
}

// source: https://www.shadertoy.com/view/cll3R4
vec3 cosineSampleHemisphere(const vec3 n, const vec2 u) {
    float r = sqrt(u.x);
    float theta = 2.0 * PI * u.y;

    vec3 b = normalize(cross(n, vec3(0.0, 1.0, 1.0)));
    vec3 t = cross(b, n);

    return normalize(r * sin(theta) * b + sqrt(1.0 - u.x) * n + r * cos(theta) * t);
}

float getOcclusion(const vec3 worldPos, const vec3 worldNormal, const float depth, const int seed) {
    float occlusion = 0.0;

    vec4 blueNoise = sampleBlueNoise(seed);

    vec3 sampleWorldDir = cosineSampleHemisphere(worldNormal, blueNoise.rg);
    vec3 sampleWorldPos = worldPos + scale * pow(blueNoise.b, scalePower) * sampleWorldDir;

    vec4 sampleUv = projectionViewMatrix * vec4(sampleWorldPos, 1.);
    sampleUv.xy /= sampleUv.w;
    sampleUv.xy = sampleUv.xy * 0.5 + 0.5;

    float sampleUnpackedDepth = textureLod(depthTexture, sampleUv.xy, 0.0).r;
    float sampleDepth = -getViewZ(sampleUnpackedDepth);

    // Compute the horizon line
    float deltaDepth = depth - sampleDepth;

    if (deltaDepth < thickness) {
        float horizon = sampleDepth + deltaDepth * bias;

        float cosTheta = dot(worldNormal, sampleWorldDir);

        float occlusionSample = max(0.0, (horizon - depth) / cosTheta);
        occlusion += occlusionSample;
    }

    return occlusion;
}

vec3 getPos(ivec2 p, float depth) {
    return getWorldPos(depth, vec2(p) / texSize);
}

vec3 computeNormalImproved(const float c0, in ivec2 p) {
    float l2 = texelFetch(depthTexture, p - ivec2(2, 0), 0).r;
    float l1 = texelFetch(depthTexture, p - ivec2(1, 0), 0).r;
    float r1 = texelFetch(depthTexture, p + ivec2(1, 0), 0).r;
    float r2 = texelFetch(depthTexture, p + ivec2(2, 0), 0).r;
    float b2 = texelFetch(depthTexture, p - ivec2(0, 2), 0).r;
    float b1 = texelFetch(depthTexture, p - ivec2(0, 1), 0).r;
    float t1 = texelFetch(depthTexture, p + ivec2(0, 1), 0).r;
    float t2 = texelFetch(depthTexture, p + ivec2(0, 2), 0).r;

    float dl = abs(l1 * l2 / (2.0 * l2 - l1) - c0);
    float dr = abs(r1 * r2 / (2.0 * r2 - r1) - c0);
    float db = abs(b1 * b2 / (2.0 * b2 - b1) - c0);
    float dt = abs(t1 * t2 / (2.0 * t2 - t1) - c0);

    vec3 ce = getPos(p, c0);

    vec3 dpdx = (dl < dr) ? ce - getPos(p - ivec2(1, 0), l1) : -ce + getPos(p + ivec2(1, 0), r1);
    vec3 dpdy = (db < dt) ? ce - getPos(p - ivec2(0, 1), b1) : -ce + getPos(p + ivec2(0, 1), t1);

    return normalize(cross(dpdx, dpdy));
}

vec3 computeNormal(vec2 uv, float unpackedDepth) {
    vec2 uv0 = uv;
    vec2 uv1 = uv + vec2(1., 0.) / texSize;
    vec2 uv2 = uv + vec2(0., 1.) / texSize;

    float depth0 = unpackedDepth;
    float depth1 = textureLod(depthTexture, uv1, 0.0).r;
    float depth2 = textureLod(depthTexture, uv2, 0.0).r;

    vec3 p0 = getWorldPos(depth0, uv0);
    vec3 p1 = getWorldPos(depth1, uv1);
    vec3 p2 = getWorldPos(depth2, uv2);

    vec3 normal = normalize(cross(p2 - p0, p1 - p0));

    return -normal;
}

float computeEdgeStrength(float depth) {
    float depthX = dFdx(depth);
    float depthY = dFdy(depth);

    // Compute the edge strength as the magnitude of the gradient
    float edgeStrength = depthX * depthX + depthY * depthY;

    return min(1., pow(pow(edgeStrength, 0.25) * 50., 4.));
}

void main() {
    float unpackedDepth = textureLod(depthTexture, vUv, 0.0).r;

    // filter out background
    if (unpackedDepth > 0.9999) {
        discard;
        return;
    }

    float depth = -getViewZ(unpackedDepth);

    vec3 worldPos = getWorldPos(unpackedDepth, vUv);
    vec3 worldNormal = computeNormal(vUv, unpackedDepth);
    // worldNormal = computeNormalImproved(unpackedDepth, ivec2(vUv * texSize));

    float occlusion = 0.0;

    for (int i = 0; i < spp; i++) {
        occlusion += getOcclusion(worldPos, worldNormal, depth, frame + i);
    }

    // occlusion /= float(spp);

    float ao = pow(1. - occlusion, power);

    // ao = computeEdgeStrength(depth);

    gl_FragColor = vec4(vec3(ao), 1.);
}
