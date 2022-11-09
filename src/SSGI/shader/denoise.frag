varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D diffuseTexture;
uniform sampler2D depthTexture;
uniform sampler2D normalTexture;
uniform sampler2D momentsTexture;
uniform sampler2D directLightTexture;
uniform vec2 invTexSize;
uniform bool horizontal;
uniform float lumaPhi;
uniform float depthPhi;
uniform float normalPhi;
uniform float roughnessPhi;
uniform float denoiseKernel;
uniform float stepSize;
uniform mat4 cameraMatrixWorld;
uniform mat4 _viewMatrix;
uniform mat4 _projectionMatrixInverse;
uniform mat4 projectionMatrix;
uniform bool isLastIteration;

#include <packing>

#define ALPHA_STEP    0.001
#define FLOAT_EPSILON 0.00001

const vec3 W = vec3(0.2125, 0.7154, 0.0721);

#define PERSPECTIVE_CAMERA

// source: https://github.com/blender/blender/blob/594f47ecd2d5367ca936cf6fc6ec8168c2b360d0/source/blender/gpu/shaders/material/gpu_shader_material_fresnel.glsl
float fresnel_dielectric_cos(float cosi, float eta) {
    /* compute fresnel reflectance without explicitly computing
     * the refracted direction */
    float c = abs(cosi);
    float g = eta * eta - 1.0 + c * c;
    float result;

    if (g > 0.0) {
        g = sqrt(g);
        float A = (g - c) / (g + c);
        float B = (c * (g + c) - 1.0) / (c * (g - c) + 1.0);
        result = 0.5 * A * A * (1.0 + B * B);
    } else {
        result = 1.0; /* TIR (no refracted component) */
    }

    return result;
}

// source: https://github.com/blender/blender/blob/594f47ecd2d5367ca936cf6fc6ec8168c2b360d0/source/blender/gpu/shaders/material/gpu_shader_material_fresnel.glsl
float fresnel_dielectric(vec3 Incoming, vec3 Normal, float eta) {
    /* compute fresnel reflectance without explicitly computing
     * the refracted direction */

    float cosine = dot(Incoming, Normal);
    return min(1.0, 5.0 * fresnel_dielectric_cos(cosine, eta));
}

// source: https://github.com/CesiumGS/cesium/blob/main/Source/Shaders/Builtin/Functions/luminance.glsl
float czm_luminance(vec3 rgb) {
    // Algorithm from Chapter 10 of Graphics Shaders.
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);
    return dot(rgb, W);
}

// source: https://github.com/mrdoob/three.js/blob/dev/examples/js/shaders/SSAOShader.js
vec3 getViewPosition(const float depth) {
    float clipW = projectionMatrix[2][3] * depth + projectionMatrix[3][3];
    vec4 clipPosition = vec4((vec3(vUv, depth) - 0.5) * 2.0, 1.0);
    clipPosition *= clipW;
    return (_projectionMatrixInverse * clipPosition).xyz;
}

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);
    vec4 inputTexel = textureLod(inputTexture, vUv, 0.);

    // skip background
    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
        gl_FragColor = inputTexel;
        gl_FragColor.a = 0.;
        return;
    }

    vec4 normalTexel = textureLod(normalTexture, vUv, 0.);
    vec3 normal = unpackRGBToNormal(normalTexel.rgb);

    float totalWeight = 1.;
    vec3 color = inputTexel.rgb;

    float depth = unpackRGBAToDepth(depthTexel);
    float luma = dot(W, inputTexel.rgb);
    vec2 pixelStepOffset = invTexSize * stepSize;

    float roughness = normalTexel.a;
    float totalSpread = jitterRoughness * roughness + jitter;
    float roughnessFactor = min(1., totalSpread * 4.);
    roughnessFactor = mix(1., roughnessFactor, 1.);

    float kernel = denoiseKernel;
    float sumVariance;

#ifdef USE_MOMENT
    if (stepSize > 1.) {
        sumVariance = inputTexel.a;
    } else {
        vec2 moment = textureLod(momentsTexture, vUv, 0.).rg;

        sumVariance = max(0.0, moment.g - moment.r * moment.r);
    }

    float colorPhi = lumaPhi * sqrt(FLOAT_EPSILON + sumVariance);
#else
    float colorPhi = lumaPhi;
#endif

    for (float i = -kernel; i <= kernel; i++) {
        if (i != 0.) {
            vec2 neighborVec = horizontal ? vec2(i, 0.) : vec2(0., i);
            vec2 neighborUv = vUv + neighborVec * pixelStepOffset;

            vec4 neighborDepthTexel = textureLod(depthTexture, neighborUv, 0.);

            float neighborDepth = unpackRGBAToDepth(neighborDepthTexel);

            float depthDiff = abs(depth - neighborDepth) * 50000.;
            float depthSimilarity = 1.0 - min(1.0, depthDiff * depthPhi);

            if (depthSimilarity > 0.) {
                vec4 neighborNormalTexel = textureLod(normalTexture, neighborUv, 0.);
                vec3 neighborNormal = unpackRGBToNormal(neighborNormalTexel.rgb);
                float neighborRoughness = neighborNormalTexel.a;

                float normalSimilarity = pow(max(0., dot(neighborNormal, normal)), normalPhi);

                if (normalSimilarity > 0.) {
                    vec4 neighborInputTexel = textureLod(inputTexture, neighborUv, 0.);
                    vec3 neighborColor = neighborInputTexel.rgb;
                    float neighborLuma = dot(W, neighborColor);

                    float lumaDiff = abs(luma - neighborLuma);
                    float lumaSimilarity = max(1.0 - lumaDiff / colorPhi, 0.0);
                    float roughnessDiff = abs(roughness - neighborRoughness);
                    float roughnessSimilarity = exp(-roughnessDiff * roughnessPhi);

                    float weight = normalSimilarity * lumaSimilarity * depthSimilarity * roughnessSimilarity;

                    if (weight > 0.) {
                        color += neighborColor * weight;

                        totalWeight += weight;

#ifdef USE_MOMENT
                        float neighborVariance;
                        if (stepSize > 1.) {
                            neighborVariance = neighborInputTexel.a;
                        } else {
                            vec2 neighborMoment = textureLod(momentsTexture, neighborUv, 0.).rg;

                            neighborVariance = max(0.0, neighborMoment.g - neighborMoment.r * neighborMoment.r);
                        }

                        sumVariance += weight * weight * neighborVariance;
#endif
                    }
                }
            }
        }
    }

    sumVariance /= totalWeight * totalWeight;
    color /= totalWeight;

    if (roughnessFactor < 1.) color = mix(inputTexel.rgb, color, roughnessFactor);

    float fresnelFactor;

    if (isLastIteration) {
        vec4 diffuseTexel = textureLod(diffuseTexture, vUv, 0.);
        vec3 diffuse = diffuseTexel.rgb;
        vec3 directLight = textureLod(directLightTexture, vUv, 0.).rgb;
        float metalness = diffuseTexel.a;

        vec3 viewPos = getViewPosition(depth);
        vec3 viewDir = normalize(viewPos);
        // vec3 viewNormal = (vec4(normal, 1.) * cameraMatrixWorld).xyz;
        vec3 viewNormal = normal;
        vec3 reflected = reflect(viewNormal, viewDir);

        float ior = 1.75;
        fresnelFactor = fresnel_dielectric(viewDir, viewNormal, ior);

        float diffuseFactor = 1. - metalness;
        float specularFactor = fresnelFactor * mix(0.125, 1., metalness * 0.25 + roughness * 0.25) * .375;

        float diffuseInfluence = 1. - 1. * specularFactor;
        vec3 diffuseColor = diffuse * diffuseInfluence + (1. - diffuseInfluence);

        color *= diffuseColor;
        color += directLight;

        sumVariance = 1.;
    }

    gl_FragColor = vec4(color, sumVariance);
}