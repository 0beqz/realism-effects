roughness *= roughness;

// view-space position of the current texel
vec3 viewPos = getViewPosition(depth);
vec3 viewDir = normalize(viewPos);

vec3 T, B;

vec3 n = viewNormal;  // view-space normal
vec3 v = viewDir;     // incoming vector

// convert view dir and view normal to world-space
vec3 V = (vec4(v, 1.) * viewMatrix).xyz;  // invert view dir
vec3 N = (vec4(n, 1.) * viewMatrix).xyz;  // invert view dir

Onb(N, T, B);

V = ToLocal(T, B, N, V);

vec3 H = SampleGGXVNDF(V, roughness, roughness, 0.25, 0.25);
if (H.z < 0.0) H = -H;

vec3 l = normalize(reflect(-V, H));
l = ToWorld(T, B, N, l);

// convert reflected vector back to view-space
l = (vec4(l, 1.) * cameraMatrixWorld).xyz;
l = normalize(l);

if (dot(viewNormal, l) < 0.) l = -l;

vec3 h = normalize(v + l);  // half vector
float VoH = max(EPSILON, dot(v, h));

VoH = pow(VoH, 0.875);

// fresnel
vec3 f0 = mix(vec3(0.04), diffuse, metalness);
vec3 F = F_Schlick(f0, VoH);

diffuseLightingColor = diffuse * (1. - metalness) * (1. - F) * diffuseLightingColor + specularLightingColor * F;