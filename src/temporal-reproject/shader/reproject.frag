vec4 velocityTexel;
float dilatedDepth;
vec2 dilatedUvOffset;
int texIndex;
bool didMove;

vec4 depthTexel;
float depth;

#define luminance(a) dot(vec3(0.2125, 0.7154, 0.0721), a)

vec3 screenSpaceToWorldSpace(const vec2 uv, const float depth, mat4 curMatrixWorld, const mat4 projMatrixInverse) {
    vec4 ndc = vec4(
        (uv.x - 0.5) * 2.0,
        (uv.y - 0.5) * 2.0,
        (depth - 0.5) * 2.0,
        1.0);

    vec4 clip = projMatrixInverse * ndc;
    vec4 view = curMatrixWorld * (clip / clip.w);

    return view.xyz;
}

vec2 viewSpaceToScreenSpace(const vec3 position, const mat4 projMatrix) {
    vec4 projectedCoord = projMatrix * vec4(position, 1.0);
    projectedCoord.xy /= projectedCoord.w;
    // [-1, 1] --> [0, 1] (NDC to screen position)
    projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

    return projectedCoord.xy;
}

bool doColorTransform[textureCount];

#ifdef logTransform
// idea from: https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/
void transformColor(inout vec3 color) {
    if (!doColorTransform[texIndex]) return;
    float lum = luminance(color);

    float diff = min(1.0, lum - 0.99);
    if (diff > 0.0) {
        color = vec3(diff * 0.1);
        return;
    }

    color = log(max(color, vec3(EPSILON)));
}

void undoColorTransform(inout vec3 color) {
    if (!doColorTransform[texIndex]) return;

    color = exp(color);
}
#else
    #define transformColor
    #define undoColorTransform
#endif

void getNeighborhoodAABB(const sampler2D tex, inout vec3 minNeighborColor, inout vec3 maxNeighborColor) {
    for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
            if (x != 0 || y != 0) {
                vec2 offset = vec2(x, y) * invTexSize;
                vec2 neighborUv = vUv + offset;

                vec4 neighborTexel = textureLod(tex, neighborUv, 0.0);
                transformColor(neighborTexel.rgb);

                minNeighborColor = min(neighborTexel.rgb, minNeighborColor);
                maxNeighborColor = max(neighborTexel.rgb, maxNeighborColor);
            }
        }
    }
}

#ifdef logClamp
void clampNeighborhood(const sampler2D tex, inout vec3 color, vec3 inputColor) {
    transformColor(inputColor);

    vec3 minNeighborColor = inputColor;
    vec3 maxNeighborColor = inputColor;

    getNeighborhoodAABB(tex, minNeighborColor, maxNeighborColor);

    transformColor(color);

    color = clamp(color, minNeighborColor, maxNeighborColor);

    undoColorTransform(color);
}
#else
void clampNeighborhood(const sampler2D tex, inout vec3 color, const vec3 inputColor) {
    vec3 minNeighborColor = inputColor;
    vec3 maxNeighborColor = inputColor;

    getNeighborhoodAABB(tex, minNeighborColor, maxNeighborColor);

    color = clamp(color, minNeighborColor, maxNeighborColor);
}
#endif

#ifdef dilation
void getDilatedDepthUVOffset(const sampler2D tex, const vec2 centerUv, out float depth, out float dilatedDepth, out vec4 closestDepthTexel) {
    float closestDepth = 0.0;

    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            vec2 offset = vec2(x, y) * invTexSize;
            vec2 neighborUv = centerUv + offset;

            vec4 neighborDepthTexel = textureLod(tex, neighborUv, 0.0);
            float neighborDepth = unpackRGBAToDepth(neighborDepthTexel);

            if (x == 0 && y == 0) depth = neighborDepth;

            if (neighborDepth > closestDepth) {
                closestDepth = neighborDepth;
                closestDepthTexel = neighborDepthTexel;
                dilatedUvOffset = offset;
            }
        }
    }

    dilatedDepth = closestDepth;
}
#endif

void getDepthAndDilatedUVOffset(sampler2D depthTex, vec2 uv, out float depth, out float dilatedDepth, out vec4 depthTexel) {
#ifdef dilation
    getDilatedDepthUVOffset(depthTex, uv, depth, dilatedDepth, depthTexel);
#else
    depthTexel = textureLod(depthTex, uv, 0.);
    depth = unpackRGBAToDepth(depthTexel);
    dilatedDepth = depth;
#endif
}

bool planeDistanceDisocclusionCheck(const vec3 worldPos, const vec3 lastWorldPos, const vec3 worldNormal, const float worldDistFactor) {
    if (abs(dot(worldNormal, worldPos)) == 0.0) return false;

    vec3 toCurrent = worldPos - lastWorldPos;
    float distToPlane = abs(dot(toCurrent, worldNormal));

    return distToPlane > depthDistance * worldDistFactor;
}

bool worldDistanceDisocclusionCheck(const vec3 worldPos, const vec3 lastWorldPos, const float worldDistFactor) {
    return distance(worldPos, lastWorldPos) > worldDistance * worldDistFactor;
}

bool validateReprojectedUV(const vec2 reprojectedUv, const bool neighborhoodClamp, const bool neighborhoodClampDisocclusionTest,
                           const float depth, const vec3 worldPos, const vec3 worldNormal) {
    if (reprojectedUv.x > 1.0 || reprojectedUv.x < 0.0 || reprojectedUv.y > 1.0 || reprojectedUv.y < 0.0) return false;

    if (neighborhoodClamp && !neighborhoodClampDisocclusionTest) return true;

    vec3 dilatedWorldPos = worldPos;
    vec3 lastWorldPos;
    float dilatedLastDepth, lastDepth;
    vec4 lastDepthTexel;
    vec2 dilatedReprojectedUv;

#ifdef dilation
    // by default the worldPos is not dilated as it would otherwise mess up reprojecting hit points in the method "reprojectHitPoint"
    dilatedWorldPos = screenSpaceToWorldSpace(vUv + dilatedUvOffset, dilatedDepth, cameraMatrixWorld, projectionMatrixInverse);

    getDepthAndDilatedUVOffset(lastDepthTexture, reprojectedUv, lastDepth, dilatedLastDepth, lastDepthTexel);

    dilatedReprojectedUv = reprojectedUv + dilatedUvOffset;
#else
    lastDepthTexel = textureLod(lastDepthTexture, reprojectedUv, 0.);
    lastDepth = unpackRGBAToDepth(lastDepthTexel);
    dilatedLastDepth = lastDepth;

    dilatedReprojectedUv = reprojectedUv;
#endif

    lastWorldPos = screenSpaceToWorldSpace(dilatedReprojectedUv, dilatedLastDepth, prevCameraMatrixWorld, prevProjectionMatrixInverse);

    float worldDistFactor = clamp((50.0 + distance(dilatedWorldPos, cameraPos)) / 100., 0.25, 1.);

#ifndef dilation
    if (worldDistanceDisocclusionCheck(dilatedWorldPos, lastWorldPos, worldDistFactor)) return false;
#endif

    return !planeDistanceDisocclusionCheck(dilatedWorldPos, lastWorldPos, worldNormal, worldDistFactor);
}

vec2 reprojectHitPoint(const vec3 rayOrig, const float rayLength, const float depth) {
    vec3 cameraRay = normalize(rayOrig - cameraPos);
    float cameraRayLength = distance(rayOrig, cameraPos);

    vec3 parallaxHitPoint = cameraPos + cameraRay * (cameraRayLength + rayLength);

    vec4 reprojectedParallaxHitPoint = prevViewMatrix * vec4(parallaxHitPoint, 1.0);
    vec2 hitPointUv = viewSpaceToScreenSpace(reprojectedParallaxHitPoint.xyz, prevProjectionMatrix);

    return hitPointUv;
}

vec2 getReprojectedUV(const bool neighborhoodClamp, const bool neighborhoodClampDisocclusionTest,
                      const float depth, const vec3 worldPos, const vec3 worldNormal, const float rayLength) {
    // hit point reprojection
    if (rayLength != 0.0) {
        vec2 reprojectedUv = reprojectHitPoint(worldPos, rayLength, depth);

        if (validateReprojectedUV(reprojectedUv, neighborhoodClamp, neighborhoodClampDisocclusionTest, depth, worldPos, worldNormal)) {
            return reprojectedUv;
        }

        return vec2(-1.);
    }

    // reprojection using motion vectors
    vec2 reprojectedUv = vUv - velocityTexel.rg;

    if (validateReprojectedUV(reprojectedUv, neighborhoodClamp, neighborhoodClampDisocclusionTest, depth, worldPos, worldNormal)) {
        return reprojectedUv;
    }

    // invalid reprojection
    return vec2(-1.);
}

vec4 SampleTextureCatmullRom(const sampler2D tex, const vec2 uv, const vec2 texSize) {
    // We're going to sample a a 4x4 grid of texels surrounding the target UV coordinate. We'll do this by rounding
    // down the sample location to get the exact center of our "starting" texel. The starting texel will be at
    // location [1, 1] in the grid, where [0, 0] is the top left corner.
    vec2 samplePos = uv * texSize;
    vec2 texPos1 = floor(samplePos - 0.5f) + 0.5f;

    // Compute the fractional offset from our starting texel to our original sample location, which we'll
    // feed into the Catmull-Rom spline function to get our filter weights.
    vec2 f = samplePos - texPos1;

    // Compute the Catmull-Rom weights using the fractional offset that we calculated earlier.
    // These equations are pre-expanded based on our knowledge of where the texels will be located,
    // which lets us avoid having to evaluate a piece-wise function.
    vec2 w0 = f * (-0.5f + f * (1.0f - 0.5f * f));
    vec2 w1 = 1.0f + f * f * (-2.5f + 1.5f * f);
    vec2 w2 = f * (0.5f + f * (2.0f - 1.5f * f));
    vec2 w3 = f * f * (-0.5f + 0.5f * f);

    // Work out weighting factors and sampling offsets that will let us use bilinear filtering to
    // simultaneously evaluate the middle 2 samples from the 4x4 grid.
    vec2 w12 = w1 + w2;
    vec2 offset12 = w2 / (w1 + w2);

    // Compute the final UV coordinates we'll use for sampling the texture
    vec2 texPos0 = texPos1 - 1.;
    vec2 texPos3 = texPos1 + 2.;
    vec2 texPos12 = texPos1 + offset12;

    texPos0 /= texSize;
    texPos3 /= texSize;
    texPos12 /= texSize;

    vec4 result = vec4(0.0);
    result += textureLod(tex, vec2(texPos0.x, texPos0.y), 0.0f) * w0.x * w0.y;
    result += textureLod(tex, vec2(texPos12.x, texPos0.y), 0.0f) * w12.x * w0.y;
    result += textureLod(tex, vec2(texPos3.x, texPos0.y), 0.0f) * w3.x * w0.y;
    result += textureLod(tex, vec2(texPos0.x, texPos12.y), 0.0f) * w0.x * w12.y;
    result += textureLod(tex, vec2(texPos12.x, texPos12.y), 0.0f) * w12.x * w12.y;
    result += textureLod(tex, vec2(texPos3.x, texPos12.y), 0.0f) * w3.x * w12.y;
    result += textureLod(tex, vec2(texPos0.x, texPos3.y), 0.0f) * w0.x * w3.y;
    result += textureLod(tex, vec2(texPos12.x, texPos3.y), 0.0f) * w12.x * w3.y;
    result += textureLod(tex, vec2(texPos3.x, texPos3.y), 0.0f) * w3.x * w3.y;

    result = max(result, vec4(0.));

    return result;
}

// source: https://iquilezles.org/articles/texture/
vec4 getTexel(const sampler2D tex, vec2 p) {
    p = p / invTexSize + 0.5;

    vec2 i = floor(p);
    vec2 f = p - i;
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    p = i + f;

    p = (p - 0.5) * invTexSize;
    return textureLod(tex, p, 0.0);
}

// source: https://www.shadertoy.com/view/stSfW1
vec2 sampleBlocky(vec2 p) {
    vec2 d = vec2(dFdx(p.x), dFdy(p.y)) / invTexSize;
    p /= invTexSize;
    vec2 fA = p - 0.5 * d, iA = floor(fA);
    vec2 fB = p + 0.5 * d, iB = floor(fB);
    return (iA + (iB - iA) * (fB - iB) / d + 0.5) * invTexSize;
}

// float computeEdgeStrength(float unpackedDepth, vec2 texelSize) {
//     // Compute the depth gradients in the x and y directions using central differences
//     float depthX = unpackRGBAToDepth(textureLod(depthTexture, vUv + vec2(texelSize.x, 0.0), 0.0)) -
//                    unpackRGBAToDepth(textureLod(depthTexture, vUv - vec2(texelSize.x, 0.0), 0.0));

//     float depthY = unpackRGBAToDepth(textureLod(depthTexture, vUv + vec2(0.0, texelSize.y), 0.0)) -
//                    unpackRGBAToDepth(textureLod(depthTexture, vUv - vec2(0.0, texelSize.y), 0.0));

//     // Calculate the gradient magnitude
//     float gradientMagnitude = sqrt(depthX * depthX + depthY * depthY);

//     // Calculate the edge strength
//     float edgeStrength = min(100000. * gradientMagnitude / (unpackedDepth + 0.001), 1.);

//     return edgeStrength * edgeStrength;
// }

float computeEdgeStrengthFast(float unpackedDepth) {
    float depthX = dFdx(unpackedDepth);
    float depthY = dFdy(unpackedDepth);

    // Compute the edge strength as the magnitude of the gradient
    float edgeStrength = depthX * depthX + depthY * depthY;

    return min(1., pow(pow(edgeStrength, 0.25) * 50., 4.));
}

vec4 sampleReprojectedTexture(const sampler2D tex, const vec2 reprojectedUv) {
    vec4 catmull = SampleTextureCatmullRom(tex, reprojectedUv, 1.0 / invTexSize);
    vec4 blocky = SampleTextureCatmullRom(tex, sampleBlocky(reprojectedUv), 1.0 / invTexSize);

    float edgeStrength = computeEdgeStrengthFast(depth);

    vec4 reprojectedTexel = mix(catmull, blocky, edgeStrength);

    return reprojectedTexel;
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