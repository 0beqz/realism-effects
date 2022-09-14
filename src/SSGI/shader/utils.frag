// source: https://github.com/mrdoob/three.js/blob/dev/examples/js/shaders/SSAOShader.js
vec3 getViewPosition(const float depth) {
    float clipW = projectionMatrix[2][3] * depth + projectionMatrix[3][3];
    vec4 clipPosition = vec4((vec3(vUv, depth) - 0.5) * 2.0, 1.0);
    clipPosition *= clipW;
    return (inverseProjectionMatrix * clipPosition).xyz;
}

// source: https://github.com/mrdoob/three.js/blob/342946c8392639028da439b6dc0597e58209c696/examples/js/shaders/SAOShader.js#L123
float getViewZ(const in float depth) {
#ifdef PERSPECTIVE_CAMERA
    return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
#else
    return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
#endif
}

// credits for transforming screen position to world position: https://discourse.threejs.org/t/reconstruct-world-position-in-screen-space-from-depth-buffer/5532/2
vec3 screenSpaceToWorldSpace(const vec2 uv, const float depth) {
    vec4 ndc = vec4(
        (uv.x - 0.5) * 2.0,
        (uv.y - 0.5) * 2.0,
        (depth - 0.5) * 2.0,
        1.0);

    vec4 clip = inverseProjectionMatrix * ndc;
    vec4 view = cameraMatrixWorld * (clip / clip.w);

    return view.xyz;
}

vec2 viewSpaceToScreenSpace(vec3 position) {
    vec4 projectedCoord = projectionMatrix * vec4(position, 1.0);
    projectedCoord.xy /= projectedCoord.w;
    // [-1, 1] --> [0, 1] (NDC to screen position)
    projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

    return projectedCoord.xy;
}

// vec2 worldSpaceToScreenSpace(vec3 worldPos){
//     vec4 ssPos = projectionMatrix * inverse(cameraMatrixWorld) * vec4(worldPos, 1.0);
//     ssPos.xy /= ssPos.w;
//     ssPos.xy = ssPos.xy * 0.5 + 0.5;

//     return ssPos.xy;
// }

#define M_PI 3.1415926535897932384626433832795

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

// ray sampling x and z are swapped to align with expected background view
vec2 equirectDirectionToUv(vec3 direction) {
    // from Spherical.setFromCartesianCoords
    vec2 uv = vec2(atan(direction.z, direction.x), acos(direction.y));
    uv /= vec2(2.0 * M_PI, M_PI);
    // apply adjustments to get values in range [0, 1] and y right side up

    uv.x += 0.5;
    uv.y = 1.0 - uv.y;

    return uv;
}

vec3 sampleEquirectEnvMapColor(vec3 direction, sampler2D map, float lod) {
    return textureLod(map, equirectDirectionToUv(direction), lod).rgb;
}

vec2 hash23(vec3 p3) {
    p3 = fract(p3 * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

// source: https://github.com/CesiumGS/cesium/blob/main/Source/Shaders/Builtin/Functions/luminance.glsl
float czm_luminance(vec3 rgb) {
    // Algorithm from Chapter 10 of Graphics Shaders.
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);
    return dot(rgb, W);
}

// source: https://github.com/gkjohnson/three-gpu-pathtracer/blob/428463b5d6d8b95d09842983f0f3690f34eadf5b/src/shader/shaderUtils.js#L63
vec3 getHemisphereSample(vec3 n, vec2 uv) {
    // https://www.rorydriscoll.com/2009/01/07/better-sampling/
    // https://graphics.pixar.com/library/OrthonormalB/paper.pdf
    float sign = n.z == 0.0 ? 1.0 : sign(n.z);
    float a = -1.0 / (sign + n.z);
    float b = n.x * n.y * a;
    vec3 b1 = vec3(1.0 + sign * n.x * n.x * a, sign * b, -sign * n.x);
    vec3 b2 = vec3(b, sign + n.y * n.y * a, -n.y);
    float r = sqrt(uv.x);
    float theta = 2.0 * M_PI * uv.y;
    float x = r * cos(theta);
    float y = r * sin(theta);
    return x * b1 + y * b2 + sqrt(1.0 - uv.x) * n;
}