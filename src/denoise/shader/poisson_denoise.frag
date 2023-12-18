varying vec2 vUv;

uniform sampler2D inputTexture;
uniform highp sampler2D depthTexture;
uniform sampler2D normalTexture; // optional, in case no gBufferTexture is used
uniform mat4 projectionMatrix;
uniform mat4 projectionMatrixInverse;
uniform mat4 cameraMatrixWorld;
uniform float radius;
uniform float phi;
uniform float lumaPhi;
uniform float depthPhi;
uniform float normalPhi;
uniform float roughnessPhi;
uniform float specularPhi;
uniform vec2 resolution;

layout(location = 0) out vec4 gOutput0;

#if textureCount == 2
uniform sampler2D inputTexture2;
layout(location = 1) out vec4 gOutput1;
#endif

#include <common>
#include <gbuffer_packing>

#define luminance(a) pow(dot(vec3(0.2125, 0.7154, 0.0721), a), 0.125)

#if textureCount == 1
#define inputTexture2 inputTexture
#endif

Material mat;
vec3 normal;
float depth;
float specularFactor;

struct InputTexel {
  vec3 rgb;
  float a;
  float luminance;
  float w;
  float totalWeight;
  bool isSpecular;
};

void toDenoiseSpace(inout vec3 color) { color = log(color + 1.); }
void toLinearSpace(inout vec3 color) { color = exp(color) - 1.; }

float getBasicNeighborWeight(inout vec2 neighborUv) {
#ifdef GBUFFER_TEXTURE
  Material neighborMat = getMaterial(gBufferTexture, neighborUv);
  vec3 neighborNormal = neighborMat.normal;
  float neighborDepth = textureLod(depthTexture, neighborUv, 0.0).r;
#else
  vec3 neighborDepthVelocityTexel = textureLod(normalTexture, neighborUv, 0.).xyz;
  vec3 neighborNormal = unpackNormal(neighborDepthVelocityTexel.b);
  float neighborDepth = neighborDepthVelocityTexel.a;
#endif

  if (neighborDepth == 1.0)
    return 0.;

  float normalDiff = 1. - max(dot(normal, neighborNormal), 0.);
  float depthDiff = 10000. * abs(depth - neighborDepth);

#ifdef GBUFFER_TEXTURE
  float roughnessDiff = abs(mat.roughness - neighborMat.roughness);

  float wBasic = exp(-normalDiff * normalPhi - depthDiff * depthPhi - roughnessDiff * roughnessPhi);
#else
  float wBasic = exp(-normalDiff * normalPhi - depthDiff * depthPhi);
#endif

  return wBasic;
}

vec3 getNormal(Material mat) {
#ifdef GBUFFER_TEXTURE
  return mat.normal;
#else
  vec3 depthVelocityTexel = textureLod(normalTexture, vUv, 0.).xyz;
  return unpackNormal(depthVelocityTexel.b);
#endif
}

const vec2 VOGEL[64] = vec2[64](
    vec2(-0.8858256694307908, 0.11039874717355916), vec2(0.5786055880516664, -0.26733045744057155), vec2(-0.7672635753829038, -0.07110981571233982),
    vec2(0.3759135641688252, -0.37408420479070015), vec2(-0.5954329857479317, -0.1899593627155645), vec2(0.6218140149124645, -0.47193466799806244),
    vec2(-0.06221497017514103, -0.4801086309223219), vec2(-0.09217110975978997, 0.08443628678269048), vec2(-0.30125974586790694, 0.9286374779856799),
    vec2(0.7263803908706608, -0.060179130590147525), vec2(0.12407653552140382, 0.39557554693510294), vec2(0.13173087756434085, 0.1718196027702562),
    vec2(0.3044598633838641, 0.5313230576478671), vec2(0.8189188737699155, -0.2524814412653198), vec2(0.5842520778248396, -0.6864033140635013),
    vec2(0.5398828029871907, 0.7840768833722203), vec2(-0.437881804270381, 0.7471676689264035), vec2(-0.3581673004861461, -0.42920412959624094),
    vec2(0.9258154000939673, 0.04733756382459124), vec2(-0.7211110218604363, 0.5958178363823942), vec2(-0.4812708600359053, 0.33485572905402117),
    vec2(0.3161598772626051, 0.7766388684641624), vec2(-0.9356925873941437, -0.21530067788015092), vec2(-0.7661115267608417, -0.363074549595771),
    vec2(-0.5677230447829313, -0.4396766362025594), vec2(0.5108647397618087, 0.5631538135075527), vec2(0.44018182266498107, -0.09677273890582583),
    vec2(-0.14149894660914825, 0.777803347966889), vec2(-0.6447488862874866, -0.6542544410480113), vec2(0.16753984018648072, -0.35802290701893436),
    vec2(-0.5149480895113892, 0.021294720204086372), vec2(0.130404621326362, -0.9346762191993162), vec2(0.13157445867645465, -0.584861660415519),
    vec2(0.7812833956192815, 0.21411738773300346), vec2(0.0036587078725838114, -0.749991075851375), vec2(0.595861375743875, 0.31316803939197974),
    vec2(-0.2507540284511754, 0.5991639318379463), vec2(-0.2238651405383096, -0.622402119896585), vec2(-0.18370833162606243, -0.8554976615345997),
    vec2(-0.5021859490837312, 0.5428482960670248), vec2(0.1197670401489102, 0.6968901320107563), vec2(0.2882286396384206, -0.7774472659236673),
    vec2(-0.2689921596114732, 0.38261366685934745), vec2(0.7205834015598361, 0.5118686954644287), vec2(0.3321002291718612, 0.12128247105001326),
    vec2(0.3823244977280216, 0.32222349144191215), vec2(-0.15243067061428453, -0.2934959806472305), vec2(0.567706325350643, 0.07638408313824151),
    vec2(-0.24617837132885717, -0.04354548759482791), vec2(0.3764071357129037, -0.5853995799318681), vec2(-0.6620391053587746, 0.17451138351337778),
    vec2(0.8424338915846228, -0.47728936538497074), vec2(0, 0), vec2(0.23583677444698697, -0.15002005138794278),
    vec2(0.033163833687322425, 0.9094092368868701), vec2(-0.07948726025481911, 0.29568864614182033), vec2(-0.02516798061375822, 0.544280784845309),
    vec2(0.9133585918338107, 0.3874933324889068), vec2(0.015454830699377673, -0.17609982455429526), vec2(-0.4084534119550491, -0.8954975210810351),
    vec2(-0.7292579037700506, 0.3742431158871351), vec2(-0.3466295835516768, 0.1430836531781011), vec2(-0.42629247348014454, -0.6774213807182204),
    vec2(-0.37464744364268177, -0.21711585149869544));

void outputTexel(inout vec4 outputFrag, InputTexel inp) {
  inp.rgb /= inp.totalWeight;

  outputFrag.rgb = inp.rgb;
  toLinearSpace(outputFrag.rgb);
  outputFrag.a = inp.a;
}

void applyWeight(inout InputTexel inp, vec2 neighborUv, float wBasic) {
  float w = wBasic;
  vec4 t;
  if (inp.isSpecular) {
    t = textureLod(inputTexture2, neighborUv, 0.);
    w *= specularFactor;
  } else {
    t = textureLod(inputTexture, neighborUv, 0.);
  }

  toDenoiseSpace(t.rgb);

  float disocclW = pow(w, 0.1);

  float lumaDiff = abs(inp.luminance - luminance(t.rgb));
  float lumaFactor = exp(-lumaDiff * lumaPhi);
  w = mix(w * lumaFactor, disocclW, pow(inp.w, 3.)) * inp.w;

  if (w > 0.01) {
    inp.rgb += w * t.rgb;
    inp.totalWeight += w;
  }
}

void main() {
  depth = textureLod(depthTexture, vUv, 0.).r;

  if (depth == 1.0 && fwidth(depth) == 0.) {
    discard;
    return;
  }

  InputTexel[textureCount] inputs;

  float maxAlpha = 0.;
#pragma unroll_loop_start
  for (int i = 0; i < textureCount; i++) {
    {
      vec4 t;

      if (isTextureSpecular[i]) {
        t = textureLod(inputTexture2, vUv, 0.);
      } else {
        t = textureLod(inputTexture, vUv, 0.);
      }

      toDenoiseSpace(t.rgb);

      // check: https://www.desmos.com/calculator/jurqfiigcf for graphs
      float age = 1. / log(exp(t.a * phi) + 1.718281828459045); // e - 1

      InputTexel inp = InputTexel(t.rgb, t.a, luminance(t.rgb), age, 1., isTextureSpecular[i]);
      maxAlpha = max(maxAlpha, inp.a);

      inputs[i] = inp;
    }
  }
#pragma unroll_loop_end

  mat = getMaterial(gBufferTexture, vUv);
  normal = getNormal(mat);
  specularFactor = exp(-(1. - mat.roughness) * specularPhi);

  float flatness = 1. - min(length(fwidth(normal)), 1.);
  flatness = pow(flatness, 2.) * 0.75 + 0.25;

  float roughnessRadius = mix(sqrt(mat.roughness), 1., 0.5 * (1. - mat.metalness));

  vec4 random = blueNoise();
  float r = radius * roughnessRadius * exp(-maxAlpha * 0.01);

  // rotate the poisson disk
  float angle = random.r * 2. * PI;
  float s = sin(angle), c = cos(angle);
  mat2 rm = mat2(c, -s, s, c) * r;

  int index = blueNoiseIndex;

  int sampleCount = int(32. / (pow(maxAlpha, 0.5) + 1.));

  for (int i = 0; i < sampleCount; i++) {
    {
      index++;
      index = index % VOGEL.length();
      vec2 offset = VOGEL[index];

      vec2 neighborUv = vUv + flatness * rm * (offset / resolution);

      float wBasic = getBasicNeighborWeight(neighborUv);

      applyWeight(inputs[0], neighborUv, wBasic);

#if textureCount == 2
      applyWeight(inputs[1], neighborUv, wBasic);
#endif
    }
  }

  // inputs[0].rgb = vec3(1.);
  // inputs[0].totalWeight = 1.;

  outputTexel(gOutput0, inputs[0]);

#if textureCount == 2
  outputTexel(gOutput1, inputs[1]);
#endif
}