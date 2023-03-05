
float dilatedDepth;
vec2 dilatedUvOffset;
int texIndex;

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

void clampNeighborhood(const sampler2D tex, inout vec3 color, const vec3 inputColor) {
    vec3 minNeighborColor = inputColor;
    vec3 maxNeighborColor = inputColor;

    getNeighborhoodAABB(tex, minNeighborColor, maxNeighborColor);

    color = clamp(color, minNeighborColor, maxNeighborColor);
}

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
    vec3 toCurrent = worldPos - lastWorldPos;
    float distToPlane = abs(dot(toCurrent, worldNormal));

    return distToPlane > depthDistance * worldDistFactor;
}

bool worldDistanceDisocclusionCheck(const vec3 worldPos, const vec3 lastWorldPos, const float worldDistFactor) {
    return distance(worldPos, lastWorldPos) > worldDistance * worldDistFactor;
}

bool validateReprojectedUV(const vec2 reprojectedUv, const bool neighborhoodClamp, const bool neighborhoodClampDisocclusionTest,
                           const float depth, const vec3 worldPos, const vec3 worldNormal) {
    if (any(lessThan(reprojectedUv, vec2(0.))) || any(greaterThan(reprojectedUv, vec2(1.)))) return false;

    if (neighborhoodClamp && !neighborhoodClampDisocclusionTest) return true;

    vec3 dilatedWorldPos = worldPos;
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

    vec3 lastWorldPos = screenSpaceToWorldSpace(dilatedReprojectedUv, dilatedLastDepth, prevCameraMatrixWorld, prevProjectionMatrixInverse);

    float worldDistFactor = clamp((50.0 + distance(dilatedWorldPos, cameraPos)) / 100., 0.25, 1.);

    if (worldDistanceDisocclusionCheck(dilatedWorldPos, lastWorldPos, worldDistFactor)) return false;

    vec4 lastNormalTexel = textureLod(lastNormalTexture, dilatedReprojectedUv, 0.);
    vec3 lastNormal = unpackRGBToNormal(lastNormalTexel.xyz);
    vec3 lastWorldNormal = normalize((vec4(lastNormal, 1.) * viewMatrix).xyz);

    return !planeDistanceDisocclusionCheck(dilatedWorldPos, lastWorldPos, worldNormal, worldDistFactor);
}

vec2 reprojectVelocity(const vec2 sampleUv) {
    vec4 velocity = textureLod(velocityTexture, sampleUv, 0.0);

    return vUv - velocity.xy;
}

vec2 reprojectHitPoint(const vec3 rayOrig, const float rayLength, const float depth) {
    vec3 cameraRay = normalize(rayOrig - cameraPos);
    float cameraRayLength = distance(rayOrig, cameraPos);

    vec3 parallaxHitPoint = cameraPos + cameraRay * (cameraRayLength + rayLength);

    vec4 reprojectedParallaxHitPoint = prevViewMatrix * vec4(parallaxHitPoint, 1.0);
    vec2 hitPointUv = viewSpaceToScreenSpace(reprojectedParallaxHitPoint.xyz, prevProjectionMatrix);

    return hitPointUv;
}

vec2 getReprojectedUV(const vec2 uv, const bool neighborhoodClamp, const bool neighborhoodClampDisocclusionTest,
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
    vec2 reprojectedUv = reprojectVelocity(uv);

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

vec4 sampleReprojectedTexture(const sampler2D tex, const vec2 reprojectedUv, const bool useCatmullRom) {
    if (useCatmullRom) {
        return SampleTextureCatmullRom(tex, reprojectedUv, 1.0 / invTexSize);
    }

    return textureLod(tex, reprojectedUv, 0.);
}
