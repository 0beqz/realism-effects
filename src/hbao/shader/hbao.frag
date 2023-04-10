varying vec2 vUv;

uniform sampler2D depthTexture;
uniform sampler2D normalTexture;
uniform sampler2D velocityTexture;
uniform sampler2D accumulatedTexture;
uniform vec3 color;
uniform float cameraNear;
uniform float cameraFar;
uniform mat4 inverseProjectionMatrix;
uniform mat4 projectionViewMatrix;
uniform mat4 cameraMatrixWorld;
uniform int frame;

uniform sampler2D blueNoiseTexture;
uniform vec2 blueNoiseRepeat;
uniform vec2 texSize;

uniform float aoDistance;
uniform float distancePower;
uniform float bias;
uniform float thickness;
uniform float power;

#include <packing>
// HBAO Utils
#include <hbao_utils>

float getOcclusion(const vec3 worldPos, const vec3 worldNormal, const float depth, const int seed, out vec3 sampleWorldDir) {
    float occlusion = 0.0;

    vec4 blueNoise = sampleBlueNoise(blueNoiseTexture, seed, blueNoiseRepeat, texSize);

    sampleWorldDir = sampleHemisphere(worldNormal, blueNoise.rg);
    vec3 sampleWorldPos = worldPos + aoDistance * pow(blueNoise.b, distancePower) * sampleWorldDir;

    // Project the sample position to screen space
    vec4 sampleUv = projectionViewMatrix * vec4(sampleWorldPos, 1.);
    sampleUv.xy /= sampleUv.w;
    sampleUv.xy = sampleUv.xy * 0.5 + 0.5;

    // Get the depth of the sample position
    float sampleUnpackedDepth = textureLod(depthTexture, sampleUv.xy, 0.0).r;
    float sampleDepth = -getViewZ(sampleUnpackedDepth);

    // Compute the horizon line
    float deltaDepth = depth - sampleDepth;

    if (deltaDepth < thickness) {
        float horizon = sampleDepth + deltaDepth * bias;

        float occlusionSample = max(0.0, horizon - depth);
        occlusion += occlusionSample * dot(worldNormal, sampleWorldDir);
    }

    return occlusion;
}

vec3 slerp(vec3 a, vec3 b, float t) {
    float cosAngle = dot(a, b);
    float angle = acos(cosAngle);

    if (abs(angle) < 0.001) {
        return mix(a, b, t);
    }

    float sinAngle = sin(angle);
    float t1 = sin((1.0 - t) * angle) / sinAngle;
    float t2 = sin(t * angle) / sinAngle;

    return (a * t1) + (b * t2);
}

// source: https://knarkowicz.wordpress.com/2014/04/16/octahedron-normal-vector-encoding/
vec2 OctWrap(vec2 v) {
    vec2 w = 1.0 - abs(v.yx);
    if (v.x < 0.0) w.x = -w.x;
    if (v.y < 0.0) w.y = -w.y;
    return w;
}

vec2 Encode(vec3 n) {
    n /= (abs(n.x) + abs(n.y) + abs(n.z));
    n.xy = n.z > 0.0 ? n.xy : OctWrap(n.xy);
    n.xy = n.xy * 0.5 + 0.5;
    return n.xy;
}

// source: https://knarkowicz.wordpress.com/2014/04/16/octahedron-normal-vector-encoding/
vec3 Decode(vec2 f) {
    f = f * 2.0 - 1.0;

    // https://twitter.com/Stubbesaurus/status/937994790553227264
    vec3 n = vec3(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
    float t = max(-n.z, 0.0);
    n.x += n.x >= 0.0 ? -t : t;
    n.y += n.y >= 0.0 ? -t : t;
    return normalize(n);
}

void main() {
    float unpackedDepth = textureLod(depthTexture, vUv, 0.0).r;

    // filter out background
    if (unpackedDepth > 0.9999) {
        discard;
        return;
    }

    vec3 worldPos = getWorldPos(unpackedDepth, vUv);

#ifdef useNormalTexture
    vec3 worldNormal = unpackRGBToNormal(textureLod(normalTexture, vUv, 0.).rgb);

    worldNormal = (vec4(worldNormal, 1.) * viewMatrix).xyz;  // view-space to world-space
#else
    vec3 worldNormal = computeWorldNormal(vUv, unpackedDepth);  // compute world normal from depth
#endif

    vec2 velocity = textureLod(velocityTexture, vUv, 0.).rg;
    vec3 accumulatedBentNormal = textureLod(accumulatedTexture, vUv - velocity.xy, 0.).xyz;

    float depth = -getViewZ(unpackedDepth);

    vec3 sampleWorldDir;
    float ao = 0.0;
    float totalWeight = 0.0;

    for (int i = 0; i < spp; i++) {
        float occ = getOcclusion(worldPos, worldNormal, depth, frame + i, sampleWorldDir);
        float visibility = pow(1. - occ, 4.);

        // if (totalWeight == 0.0) totalWeight = visibility;
        totalWeight += visibility;

        worldNormal = slerp(worldNormal, sampleWorldDir, visibility / totalWeight);

        ao += visibility;
    }

    ao /= float(spp);

    ao = pow(ao, power);

    vec3 aoColor = mix(color, vec3(1.), ao);

    gl_FragColor = vec4(aoColor, 1.);
}
