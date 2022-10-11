varying vec2 vUv;

uniform sampler2D diffuseTexture;
uniform sampler2D inputTexture;
uniform sampler2D depthTexture;
uniform sampler2D normalTexture;
uniform sampler2D momentsTexture;
uniform vec2 invTexSize;
uniform bool horizontal;
uniform float lumaPhi;
uniform float depthPhi;
uniform float normalPhi;
uniform float roughnessPhi;
uniform float denoiseKernel;
uniform float jitter;
uniform float jitterRoughness;
uniform float stepSize;

#include <packing>

#define ALPHA_STEP    0.001
#define FLOAT_EPSILON 0.00001

// source: https://github.com/CesiumGS/cesium/blob/main/Source/Shaders/Builtin/Functions/luminance.glsl
float czm_luminance(vec3 rgb) {
    // Algorithm from Chapter 10 of Graphics Shaders.
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);
    return dot(rgb, W);
}

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

    // skip background
    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.) return;

    vec4 inputTexel = textureLod(inputTexture, vUv, 0.);

    vec4 normalTexel = textureLod(normalTexture, vUv, 0.);
    vec3 normal = unpackRGBToNormal(normalTexel.rgb);

    float roughness = normalTexel.a;
    float roughnessFactor = min(1., (jitterRoughness * roughness + jitter) * 4.);
    roughnessFactor = mix(1., roughnessFactor, roughnessPhi);

    float kernel = ceil(denoiseKernel * roughnessFactor + FLOAT_EPSILON);

    float totalWeight = 1.;
    vec3 color = inputTexel.rgb;

    float depth = unpackRGBAToDepth(depthTexel);
    float luma = czm_luminance(inputTexel.rgb);

    for (float i = -kernel; i <= kernel; i++) {
        if (i != 0.) {
            vec2 neighborVec = horizontal ? vec2(i, 0.) : vec2(0., i);
            vec2 neighborUv = vUv + neighborVec * invTexSize * stepSize;

            if (all(greaterThanEqual(neighborUv, vec2(0.))) && all(lessThanEqual(neighborUv, vec2(1.)))) {
                vec4 neighborDepthTexel = textureLod(depthTexture, neighborUv, 0.);

                if (dot(neighborDepthTexel.rgb, neighborDepthTexel.rgb) != 0.) {
                    float neighborDepth = unpackRGBAToDepth(neighborDepthTexel);
                    vec3 neighborColor = textureLod(inputTexture, neighborUv, 0.).rgb;
                    float neighborLuma = czm_luminance(neighborColor);

                    float depthDiff = abs(depth - neighborDepth) * 50000.;
                    float lumaDiff = abs(luma - neighborLuma);

                    vec4 neighborNormalTexel = textureLod(normalTexture, neighborUv, 0.);
                    vec3 neighborNormal = unpackRGBToNormal(neighborNormalTexel.rgb);

#ifdef USE_MOMENT
                    vec2 moment = textureLod(momentsTexture, neighborUv, 0.).rg;
                    float variance = max(0.0, moment.g - moment.r * moment.r);

                    float colorPhi = lumaPhi * sqrt(max(0.0, FLOAT_EPSILON + variance));
#else
                    float colorPhi = lumaPhi;
#endif

                    float normalSimilarity = pow(max(0., dot(neighborNormal, normal)), normalPhi);
                    float lumaSimilarity = clamp(1.0 - lumaDiff / colorPhi, 0., 1.);
                    float depthSimilarity = exp(-depthDiff * depthPhi);

                    float weight = normalSimilarity * lumaSimilarity * depthSimilarity;

                    if (weight > 0.) {
                        color += neighborColor * weight;

                        totalWeight += weight;
                    }
                }
            }
        }
    }

    color /= totalWeight;

    if (min(color.r, min(color.g, color.b)) < 0.0) color = inputTexel.rgb;

    if (roughnessFactor < 1.) color = mix(inputTexel.rgb, color, roughnessFactor);

    gl_FragColor = vec4(color, inputTexel.a);
}