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

vec2 Encode(vec3 n) {
    vec2 f;
    f.x = atan(n.y, n.x) * (1.0 / 3.14159265);
    f.y = n.z;

    f = f * 0.5 + 0.5;
    return f;
}

vec3 Decode(vec2 f) {
    vec2 ang = f * 2.0 - 1.0;

    vec2 scth = vec2(sin(ang.x * 3.14159265), cos(ang.x * 3.14159265));
    vec2 scphi = vec2(sqrt(1.0 - ang.y * ang.y), ang.y);

    vec3 n;
    n.x = scth.y * scphi.x;
    n.y = scth.x * scphi.x;
    n.z = scphi.y;
    return n;
}

// Returns +/- 1
vec2 signNotZero(vec2 v) {
    return vec2((v.x >= 0.0) ? +1.0 : -1.0, (v.y >= 0.0) ? +1.0 : -1.0);
}

// Assume normalized input. Output is on [-1, 1] for each component.
vec2 float32x3_to_oct(in vec3 v) {
    // Project the sphere onto the octahedron, and then onto the xy plane
    vec2 p = v.xy * (1.0 / (abs(v.x) + abs(v.y) + abs(v.z)));
    // Reflect the folds of the lower hemisphere over the diagonals
    return (v.z <= 0.0) ? ((1.0 - abs(p.yx)) * signNotZero(p)) : p;
}

vec3 oct_to_float32x3(vec2 e) {
    vec3 v = vec3(e.xy, 1.0 - abs(e.x) - abs(e.y));
    if (v.z < 0.) v.xy = (1.0 - abs(v.yx)) * signNotZero(v.xy);
    return normalize(v);
}

vec2 encode(vec3 n) {
    float f = sqrt(8.0 * n.z + 8.0);
    return n.xy / f + 0.5;
}

vec3 decode(vec2 enc) {
    vec2 fenc = enc.xy * 4.0 - 2.0;
    float f = dot(fenc, fenc);
    float g = sqrt(1.0 - f / 4.0);
    vec3 n;
    n.xy = fenc * g;
    n.z = 1.0 - f / 2.0;
    return n;
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
    vec4 accumulatedBentNormalTexel = textureLod(accumulatedTexture, vUv - velocity.xy, 0.);
    vec3 accumulatedBentNormal = accumulatedBentNormalTexel.xyz;

    if (dot(accumulatedBentNormal, accumulatedBentNormal) != 0.0) {
        // if (dot(worldNormal, accumulatedBentNormal) > 0.0) worldNormal = accumulatedBentNormal;
        worldNormal = mix(worldNormal, decode(accumulatedBentNormalTexel.xy), 0.75);
    }

    float depth = -getViewZ(unpackedDepth);

    vec3 sampleWorldDir;
    float ao = 0.0;
    float totalWeight = 0.0;

    for (int i = 0; i < spp; i++) {
        float occ = getOcclusion(worldPos, worldNormal, depth, frame + i, sampleWorldDir);
        float visibility = 1. - occ;
        ao += visibility;

        // if (totalWeight == 0.0) totalWeight = visibility;
        totalWeight += visibility;

        // worldNormal = slerp(worldNormal, sampleWorldDir, visibility / totalWeight);
        // worldNormal = normalize(worldNormal);
    }

    ao /= float(spp);

    ao = pow(ao, 4.);

    vec3 aoColor = mix(color, vec3(1.), ao);

    gl_FragColor = vec4(encode(worldNormal), ao, 1.);
}
