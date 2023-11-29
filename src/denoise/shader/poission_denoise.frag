varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D depthTexture;
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

Material mat;
vec3 normal;
float depth;
float glossiness;
float specularFactor;

struct InputTexel {
  vec3 rgb;
  float a;
  float luminance;
  float w;
  float totalWeight;
  bool isSpecular;
};

void getNeighborWeight(inout InputTexel[textureCount] inputs, inout vec2 neighborUv) {
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
    return;

  float normalDiff = 1. - max(dot(normal, neighborNormal), 0.);
  float depthDiff = 10000. * abs(depth - neighborDepth);

#ifdef GBUFFER_TEXTURE
  float roughnessDiff = abs(mat.roughness - neighborMat.roughness);

  float wBasic = exp(-normalDiff * normalPhi - depthDiff * depthPhi - roughnessDiff * roughnessPhi);
#else
  float wBasic = exp(-normalDiff * normalPhi - depthDiff * depthPhi);
#endif

  float disocclW = pow(wBasic, 0.1);

  for (int i = 0; i < textureCount; i++) {
    float w = 1.0;

    vec4 t;
    if (inputs[i].isSpecular) {
      t = textureLod(inputTexture2, neighborUv, 0.);
      w *= specularFactor;
    } else {
      t = textureLod(inputTexture, neighborUv, 0.);
    }

    float lumaDiff = abs(inputs[i].luminance - luminance(t.rgb));
    float lumaFactor = exp(-lumaDiff * lumaPhi);

    w *= mix(wBasic * lumaFactor, disocclW, pow(inputs[i].w, 3.)) * inputs[i].w;

    if (w > 0.01) {
      inputs[i].rgb += w * t.rgb;
      inputs[i].totalWeight += w;
    }
  }
}

vec3 getNormal(Material mat) {
#ifdef GBUFFER_TEXTURE
  return mat.normal;
#else
  vec3 depthVelocityTexel = textureLod(normalTexture, vUv, 0.).xyz;
  return unpackNormal(depthVelocityTexel.b);
#endif
}

const vec2 poissonDisk[8] = POISSON_DISK_SAMPLES;

const vec2 VOGEL[128] = vec2[128](
    vec2(0, 0), vec2(-0.06517481674063706, 0.059705470962252497), vec2(0.010928215589619985, -0.12452138010810347),
    vec2(0.09314779681740024, 0.12149480625962707), vec2(-0.17407439574809486, -0.0307913095683775), vec2(0.16676178246462678, -0.10608019565036866),
    vec2(-0.05620598074412254, 0.20908344680675064), vec2(-0.10778476085217359, -0.20753299816665238), vec2(0.23483032408102952, 0.0857596577185255),
    vec2(-0.2451041290892596, 0.10117542143917939), vec2(0.11846855711477096, -0.25316042537320926), vec2(0.08773535965331819, 0.2797141517093887),
    vec2(-0.2649157479539452, -0.153524090897819), vec2(0.3112555517614624, -0.06842865991430468), vec2(-0.19020618014728685, 0.27054871841089523),
    vec2(-0.043992627302161025, -0.33948806863136316), vec2(0.27034424495722487, 0.22784641585618157),
    vec2(-0.36412328605256056, 0.015057641059779657), vec2(0.2658110303637807, -0.26451747794228125),
    vec2(-0.017796449760760003, 0.38486463383365416), vec2(-0.25326252697303375, -0.3034931505507717), vec2(0.4014289923779361, 0.0540117031617676),
    vec2(-0.3403098887188704, 0.2367787567332636), vec2(0.09303719196107027, -0.4135596461358373), vec2(0.21528563399786013, 0.3757021370635778),
    vec2(-0.4210347019645154, -0.13432155352605069), vec2(0.4091359349437633, -0.18903117927392987), vec2(-0.17730987392767059, 0.4236728792450062),
    vec2(-0.15829655894591818, -0.4401047596037578), vec2(0.42133761943563947, 0.22144324430496473), vec2(-0.46813234080986477, 0.12339818267655571),
    vec2(0.2661600381495993, -0.4139400126735804), vec2(0.08468808625193588, 0.4927757380867941), vec2(-0.40144081480188476, -0.3108983309881205),
    vec2(0.5136285001055791, -0.04255307132620411), vec2(-0.35509909001370854, 0.38385171130455586), vec2(0.0025870971470846197, -0.5303237755639016),
    vec2(0.36123592175467584, 0.3982098803822548), vec2(-0.5425372771106872, -0.050282232899121204), vec2(0.43968890658143667, -0.3337082040184519),
    vec2(-0.10005486467808196, 0.5499900217769871), vec2(-0.3014342987665967, -0.47900925202660766), vec2(0.552450787070846, 0.15140385683595603),
    vec2(-0.5156632089896895, 0.2646298450561762), vec2(0.20380842562050094, -0.5497382337495663), vec2(0.2235587931514946, 0.5491666104240563),
    vec2(-0.5417226557177703, -0.25673247609542116), vec2(0.5790630888843576, -0.17853133924246065), vec2(-0.3096291931577869, 0.5283273253812052),
    vec2(-0.12990140705325584, -0.6049281977603493), vec2(0.5095294096534291, 0.3619458256400093), vec2(-0.626373337803625, 0.07806370276092287),
    vec2(0.41312860615227454, -0.48536043800322126), vec2(0.023450371690448557, 0.6430494382763893), vec2(-0.45590630965635603, -0.4626277518864631),
    vec2(0.6546503475333809, 0.03347271238521947), vec2(-0.5099024935458752, 0.4213068324578878), vec2(0.09220999203793444, -0.6609158928096404),
    vec2(0.3817547910382434, 0.5544260812041106), vec2(-0.6616345736523853, -0.15224056932311522), vec2(0.5956907174408596, -0.3374945468519366),
    vec2(-0.21302280920173303, 0.6566458579476475), vec2(-0.2888201773921976, -0.6332123696921432), vec2(0.6458420539406835, 0.2739991630674795),
    vec2(-0.6665354154814677, 0.23607316643139967), vec2(0.3346011703421754, -0.6291697360853004), vec2(0.17963966149164415, 0.6952370761252362),
    vec2(-0.6066307070082692, -0.3942545945384118), vec2(0.7189315966692335, -0.11994731889720077), vec2(-0.45238464895249675, 0.5782824823493499),
    vec2(-0.057461760684343915, -0.7372741322324113), vec2(0.5442382897315522, 0.5084212662645762), vec2(-0.7499643036178749, -0.007317328676226743),
    vec2(0.561804365803923, -0.5046665776169965), vec2(-0.0738604343752942, 0.7567493879970388), vec2(-0.45979003429229365, -0.6119890720964644),
    vec2(0.7574271136722696, 0.14161273768307306), vec2(-0.6584508385564806, 0.40988412167863686), vec2(0.20999889937535163, -0.7518480313608202),
    vec2(0.3552751330504561, 0.700690430815193), vec2(-0.7399174380985333, -0.2784280603633607), vec2(0.7382387251956805, -0.2963377880417153),
    vec2(-0.34629901758018766, 0.7215968337118704), vec2(-0.23349238249155355, -0.7706612792390819), vec2(0.6969048938242328, 0.41300553139617235),
    vec2(-0.7975626329524769, 0.16720151469981584), vec2(0.477941719432439, -0.665917947517533), vec2(0.09796641349738522, 0.818590301571219),
    vec2(-0.6287699520312694, -0.5405074906257963), vec2(0.8334384230915107, -0.02632289715696297), vec2(-0.6001139727797163, 0.585651961214633),
    vec2(0.04716300445370022, -0.8418510266139135), vec2(0.5368110888192983, 0.6561888866177478), vec2(-0.8436248906225075, -0.12189972896673024),
    vec2(0.7081818195422765, -0.48254897209484393), vec2(-0.19727512353778823, 0.8386119636835325), vec2(-0.42321974549035435, -0.7555693528903086),
    vec2(0.8267213236539249, 0.2726616089879585), vec2(-0.7978599974655284, 0.35922753853832956), vec2(0.34742152310335345, -0.8079206553149548),
    vec2(0.29102351616591365, 0.8345988935041959), vec2(-0.7822372303580902, -0.4209125983404442), vec2(0.8653722329919247, -0.2191024837069863),
    vec2(-0.4924935277698993, 0.7497583778156529), vec2(-0.14399908274554968, -0.8898113643736183), vec2(0.7106314373142483, 0.5615295720624922),
    vec2(-0.9075965421746612, 0.06628360757078974), vec2(0.6273981596900619, -0.6650631918979757), vec2(-0.013442524562209788, 0.9184602868569738),
    vec2(-0.613318781585251, -0.6894944322870078), vec2(0.9221903233467522, 0.09455161302491139), vec2(-0.7472366872973808, 0.5557201032505809),
    vec2(0.17639478406596715, -0.9186320700663138), vec2(0.4926437068238015, 0.8000716706188916), vec2(-0.9076906539529821, -0.2583073299896998),
    vec2(0.8474796729445951, -0.42451820213710767), vec2(-0.33961423333734053, 0.8893324308236434), vec2(-0.3518211949881217, -0.8889793848887217),
    vec2(0.8635859945126285, 0.41963583031199125), vec2(-0.9241324677551511, 0.2750757750889282), vec2(0.49769356622998123, -0.8305426624402165),
    vec2(0.19484658250335593, 0.9525477989511932), vec2(-0.7903564296229858, -0.5731157947165705), vec2(0.9738853535509674, -0.11173548290005036),
    vec2(-0.6452435716968451, 0.7432433875816847), vec2(-0.026376885441284335, -0.9878596863494418), vec2(0.6894806090982932, 0.7134363949767679),
    vec2(-0.9942429819005854, -0.060567259649355415));

void outputTexel(inout vec4 outputFrag, InputTexel inp) {
  inp.rgb /= inp.totalWeight;

  outputFrag.rgb = inp.rgb;
  outputFrag.a = inp.a;
}

void main() {
  depth = textureLod(depthTexture, vUv, 0.).r;

  if (depth == 1.0) {
    discard;
    return;
  }

  InputTexel[textureCount] inputs;

  float maxAlpha = 0.;
  for (int i = 0; i < textureCount; i++) {
    vec4 t;
    if (i == 0) {
      t = textureLod(inputTexture, vUv, 0.);
    } else {
      t = textureLod(inputTexture2, vUv, 0.);
    }

    // check: https://www.desmos.com/calculator/jurqfiigcf for graphs
    float age = 1. / log(exp(t.a * phi) + 1.718281828459045); // e - 1

    InputTexel inp = InputTexel(t.rgb, t.a, luminance(t.rgb), age, 1., isTextureSpecular[i]);
    maxAlpha = max(maxAlpha, inp.a);

    inputs[i] = inp;
  }

  mat = getMaterial(gBufferTexture, vUv);
  normal = getNormal(mat);
  glossiness = max(0., 4. * (1. - mat.roughness / 0.25));
  specularFactor = exp(-glossiness * specularPhi);

  float flatness = 1. - min(length(fwidth(normal)), 1.);
  flatness = pow(flatness, 2.) * 0.75 + 0.25;

  float roughnessRadius = mix(sqrt(mat.roughness), 1., 0.5 * (1. - mat.metalness));

  vec4 random = blueNoise();
  float r = radius * roughnessRadius * exp(-maxAlpha * 0.01);

  // rotate the poisson disk
  float angle = random.g * 2. * PI;
  float s = sin(angle), c = cos(angle);
  mat2 rm = mat2(c, -s, s, c) * r;

  for (int i = 0; i < 8; i++) {
    int index = blueNoiseIndex + i;
    index = index % 128;
    vec2 offset = VOGEL[index];

    vec2 neighborUv = vUv + flatness * r * (offset / resolution);

    vec2 offset2 = rm * poissonDisk[i];
    // neighborUv = vUv + offset2;

    getNeighborWeight(inputs, neighborUv);
  }

  // inputs[0].rgb = vec3(flatness);
  // inputs[0].totalWeight = 1.;

  outputTexel(gOutput0, inputs[0]);

#if textureCount == 2
  outputTexel(gOutput1, inputs[1]);
#endif
}