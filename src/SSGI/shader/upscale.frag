varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D depthTexture;
uniform sampler2D normalTexture;
uniform vec2 invTexSize;
uniform bool horizontal;
uniform float denoisePower;
uniform float denoiseSharpness;
uniform float denoiseKernel;
uniform float jitter;
uniform float jitterRoughness;
uniform float stepSize;

#include <packing>

#define ALPHA_STEP    0.001
#define FLOAT_EPSILON 0.00001

const float maxDepthDifference = 0.000025;

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

    float totalWeight = 1.;

    vec4 inputTexel = textureLod(inputTexture, vUv, 0.);
    vec3 color = inputTexel.rgb;
    float alpha = inputTexel.a;
    float pixelSample = alpha / ALPHA_STEP + 1.0;

    vec4 normalTexel = textureLod(normalTexture, vUv, 0.);
    vec3 normal = unpackRGBToNormal(normalTexel.rgb);
    float roughness = normalTexel.a;
    float roughnessFactor = min(1., jitterRoughness * roughness + jitter);

    float kernel = denoiseKernel;

    kernel = round(kernel * roughnessFactor);

    if (kernel == 0.) {
        gl_FragColor = vec4(color, inputTexel.a);
        return;
    }

    float similarityMix = 1.0 - denoiseSharpness;
    float depth = unpackRGBAToDepth(depthTexel);
    float luma = czm_luminance(inputTexel.rgb);
    float phiColor = 10.0 * sqrt(FLOAT_EPSILON + luma);

    for (float i = -kernel; i <= kernel; i++) {
        if (i != 0.) {
            vec2 neighborVec = horizontal ? vec2(i, 0.) : vec2(0., i);
            vec2 neighborUv = vUv + neighborVec * invTexSize * stepSize;

            if (all(greaterThanEqual(neighborUv, vec2(0.))) && all(lessThanEqual(neighborUv, vec2(1.)))) {
                float neighborDepth = unpackRGBAToDepth(textureLod(depthTexture, neighborUv, 0.));
                float neighborLuma = czm_luminance(inputTexel.rgb);

                float depthDiff = abs(depth - neighborDepth) * depth;
                depthDiff /= maxDepthDifference;

                if (depthDiff < 1.) {
                    vec4 neighborNormalTexel = textureLod(normalTexture, neighborUv, 0.);
                    vec3 neighborNormal = unpackRGBToNormal(neighborNormalTexel.rgb);

                    float lumaDiff = abs(luma - neighborLuma);

                    float lumaPhi = sqrt(luma);

                    float normalSimilarity = dot(neighborNormal, normal);
                    float lumaSimilarity = 1.0 - lumaDiff * lumaPhi;
                    float depthSimilarity = exp(-abs(depth - neighborDepth));

                    float similarity = mix(normalSimilarity * lumaSimilarity * depthSimilarity, 1., 0.);

                    float weight = 1. - depthDiff;
                    weight *= similarity;

                    if (weight > 0.) {
                        weight = pow(weight, denoisePower);
                        totalWeight += weight;

                        color += textureLod(inputTexture, neighborUv, 0.).rgb * weight;
                    }
                }
            }
        }
    }

    color /= totalWeight;

    if (min(color.r, min(color.g, color.b)) < 0.0) color = inputTexel.rgb;

    gl_FragColor = vec4(color, inputTexel.a);
}