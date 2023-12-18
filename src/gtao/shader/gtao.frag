varying vec2 vUv;

uniform highp sampler2D depthTexture;

uniform mat4 projectionViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 cameraMatrixWorld;
uniform mat4 projectionMatrixInverse;
uniform vec2 resolution;

uniform float cameraNear;
uniform float cameraFar;

uniform float aoDistance;
uniform float distancePower;
uniform float bias;
uniform float thickness;

#include <packing>

// source: https://github.com/N8python/ssao/blob/master/EffectShader.js#L52
vec3 getWorldPos(const float depth, const vec2 coord) {
  float z = depth * 2.0 - 1.0;
  vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
  vec4 viewSpacePosition = projectionMatrixInverse * clipSpacePosition;

  // Perspective division
  vec4 worldSpacePosition = cameraMatrixWorld * viewSpacePosition;
  worldSpacePosition.xyz /= worldSpacePosition.w;

  return worldSpacePosition.xyz;
}

vec3 computeWorldNormal(vec2 uv) {
  vec2 size = vec2(textureSize(depthTexture, 0));
  ivec2 p = ivec2(uv * size);
  float c0 = texelFetch(depthTexture, p, 0).x;
  float l2 = texelFetch(depthTexture, p - ivec2(2, 0), 0).x;
  float l1 = texelFetch(depthTexture, p - ivec2(1, 0), 0).x;
  float r1 = texelFetch(depthTexture, p + ivec2(1, 0), 0).x;
  float r2 = texelFetch(depthTexture, p + ivec2(2, 0), 0).x;
  float b2 = texelFetch(depthTexture, p - ivec2(0, 2), 0).x;
  float b1 = texelFetch(depthTexture, p - ivec2(0, 1), 0).x;
  float t1 = texelFetch(depthTexture, p + ivec2(0, 1), 0).x;
  float t2 = texelFetch(depthTexture, p + ivec2(0, 2), 0).x;
  float dl = abs((2.0 * l1 - l2) - c0);
  float dr = abs((2.0 * r1 - r2) - c0);
  float db = abs((2.0 * b1 - b2) - c0);
  float dt = abs((2.0 * t1 - t2) - c0);
  vec3 ce = getWorldPos(c0, uv).xyz;
  vec3 dpdx = (dl < dr) ? ce - getWorldPos(l1, (uv - vec2(1.0 / size.x, 0.0))).xyz : -ce + getWorldPos(r1, (uv + vec2(1.0 / size.x, 0.0))).xyz;
  vec3 dpdy = (db < dt) ? ce - getWorldPos(b1, (uv - vec2(0.0, 1.0 / size.y))).xyz : -ce + getWorldPos(t1, (uv + vec2(0.0, 1.0 / size.y))).xyz;
  return normalize(cross(dpdx, dpdy));
}

#define PI 3.14159265358979323846264338327950288

// source: https://www.shadertoy.com/view/cll3R4
vec3 cosineSampleHemisphere(const vec3 n, const vec2 u) {
  float r = sqrt(u.x);
  float theta = 2.0 * PI * u.y;

  vec3 b = normalize(cross(n, vec3(0.0, 1.0, 1.0)));
  vec3 t = cross(b, n);

  return normalize(r * sin(theta) * b + sqrt(1.0 - u.x) * n + r * cos(theta) * t);
}

const vec2 VOGEL[16] = vec2[16](
    vec2(0.030909661398755346, -0.35219964910859053), vec2(0.24815307104280765, 0.7911510938702059), vec2(-0.18434221951957994, 0.16887257356538096),
    vec2(0.47167354889397395, -0.30004010277588555), vec2(0.2634617551286817, 0.3436392055405124), vec2(-0.12442994035028206, -0.9602172618446438),
    vec2(-0.49235674265771434, -0.08709097518965582), vec2(-0.15897452050963823, 0.5913772922836407), vec2(-0.6932591671033536, 0.2861673063562022),
    vec2(0, 0), vec2(0.6642004583437224, 0.24256494210002652), vec2(-0.5379843192229464, 0.7652273337186949),
    vec2(0.8803636453299621, -0.19354547781165166), vec2(0.33507968037296143, -0.7160458140378687), vec2(-0.30486134122856906, -0.586991961294461),
    vec2(-0.7492948872853635, -0.4342317029973909));

float getOcclusion() {
  // Fetch depth and normal values
  float depth = texture(depthTexture, vUv).r;
  vec3 normal = computeWorldNormal(vUv);
  vec3 worldPos = getWorldPos(depth, vUv);
  float viewZ = abs(perspectiveDepthToViewZ(depth, cameraNear, cameraFar));

  // Initialize AO value
  float ao = 0.0;

  const int numSamples = 16;
  float radius = 0.25;

  // AO sampling loop
  for (int i = 0; i < numSamples; ++i) {
    vec4 random = blueNoise(vUv, blueNoiseIndex * numSamples + i);
    vec2 a = VOGEL[i] * 0.5 + 0.5;

    vec3 sampleWorldDir = cosineSampleHemisphere(normal, a);

    vec3 sampleWorldPos = worldPos + 4. * random.r * radius * sampleWorldDir;

    // Project the sample position to screen space
    vec4 sampleUv = projectionViewMatrix * vec4(sampleWorldPos, 1.);
    sampleUv.xy /= sampleUv.w;
    sampleUv.xy = sampleUv.xy * 0.5 + 0.5;

    // Sample position
    vec2 samplePos = vUv + VOGEL[i] * radius / resolution;
    samplePos = sampleUv.xy;

    // Fetch sample depth and normal
    float sampleDepth = texture(depthTexture, samplePos).r;
    vec3 sampleNormal = computeWorldNormal(samplePos);

    float sampleViewZ = abs(perspectiveDepthToViewZ(sampleDepth, cameraNear, cameraFar));

    // Calculate occlusion factor
    float sampleDepthDiff = max(0.0, viewZ - sampleViewZ);
    sampleDepthDiff = pow(sampleDepthDiff, 4.);
    float normalDot = dot(normal, sampleNormal);
    ao += smoothstep(0.0, 1.0, 1.0 - sampleDepthDiff) * normalDot;
  }

  // Final AO value (average of samples)
  ao /= float(numSamples);

  return ao;
}

void main() {
  vec4 random = blueNoise();

  float ao = getOcclusion();

  gl_FragColor = vec4(ao);
}