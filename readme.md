# three.js Realism Effects

A collection of the following effects for three.js:

- SSGI
  <br></br>
  [<img src="https://raw.githubusercontent.com/0beqz/realism-effects/main/screenshots/ssgi.webp">](https://realism-effects.vercel.app)
  <br></br>
  <br></br>
  [<img src="https://raw.githubusercontent.com/0beqz/realism-effects/main/screenshots/ssgi2.webp">](https://realism-effects.vercel.app)
  <br></br>
- Motion Blur
  <br></br>
  [<img src="https://raw.githubusercontent.com/0beqz/realism-effects/main/screenshots/motion_blur.webp">](https://realism-effects.vercel.app)
  <br></br>
- TRAA
  <br>
  TRAA (left)&nbsp;&nbsp;&nbsp; No Anti-Aliasing (right)
  <br></br>
  [<img src="https://raw.githubusercontent.com/0beqz/realism-effects/main/screenshots/traa_comp.webp">](https://realism-effects.vercel.app?traa_test=true)
  <br></br>
  AA comparison scenes: [Model Comparision](https://realism-effects.vercel.app/?traa_test=true&traa_test_model=true), [General Comparison](https://realism-effects.vercel.app/?traa_test=true)

If you only want reflections or diffuse lighting from SSGI, then you can also use these effects too:

- SSR
- SSDGI

## Usage

This effect uses postprocessing.js. If you don't have it installed, install it like so:

```shell
npm i postprocessing
```

Then install this effect by running:

```shell
npm i realism-effects
```

Then add it to your code like so:

```javascript
import * as POSTPROCESSING from "postprocessing"
import { SSGIEffect, TRAAEffect, MotionBlurEffect, VelocityDepthNormalPass } from "realism-effects"

const composer = new POSTPROCESSING.EffectComposer(renderer)

const velocityDepthNormalPass = new VelocityDepthNormalPass(scene, camera)
composer.addPass(velocityDepthNormalPass)

// SSGI
const ssgiEffect = new SSGIEffect(scene, camera, velocityDepthNormalPass, options?)

// TRAA
const traaEffect = new TRAAEffect(scene, camera, velocityDepthNormalPass)

// Motion Blur
const motionBlurEffect = new MotionBlurEffect(velocityDepthNormalPass)

const effectPass = new POSTPROCESSING.EffectPass(camera, ssgiEffect, traaEffect, motionBlur)

composer.addPass(effectPass)
```

If you use SSGI, then you don't have to use the RenderPass anymore as SSGI does the rendering then. You can save performance by leaving it out. Keep in mind that then you need to put TRAA and Motion Blur in a separate pass like so:

```javascript
const effectPass = new POSTPROCESSING.EffectPass(camera, ssgiEffect)
const effectPass2 = new POSTPROCESSING.EffectPass(camera, traaEffect, motionBlur)

composer.addPass(effectPass)
composer.addPass(effectPass2)
```

> **NOTE**: `OrthographicCamera` isn't supported yet. Only `PerspectiveCamera` is supported at the moment. It'll be supported in the future.

### Options

<details>
<summary>Default values of the optional "options" parameter</summary>

```javascript
const options = {
	distance: 10,
	thickness: 10,
	autoThickness: false,
	maxRoughness: 1,
	blend: 0.9,
	denoiseIterations: 1,
	denoiseKernel: 2,
	denoiseDiffuse: 10,
	denoiseSpecular: 10,
	depthPhi: 2,
	normalPhi: 50,
	roughnessPhi: 1,
	envBlur: 0.5,
	importanceSampling: true,
	directLightMultiplier: 1,
	steps: 20,
	refineSteps: 5,
	spp: 1,
	resolutionScale: 1,
	missedRays: false
}
```

</details>

### ❗ Highly recommended: Use a GUI to tweak the options

Since the right options for an SSGI effect depend a lot on the scene, it can happen that you don't seem to have an effect at all in your scene when you use the SSGI effect for the first time in it without any configuration. This can have multiple causes such as `distance` being way too low for your scene for example. So to find out which SSGI options are right for your scene, you should use a GUI to find the right values easily. The [example](https://github.com/0beqz/realism-effects/tree/main/example) already comes with a simple one-file GUI [`SSGIDebugGUI.js`](https://github.com/0beqz/traa/blob/main/example/SSGIDebugGUI.js) that you can use in your project like so:

- First install the npm package of the module used for the GUI:

```shell
npm i tweakpane
```

- then just copy the `SSGIDebugGUI.js` to your project and initialize it like so in your scene:

```javascript
import { SSGIDebugGUI } from "./SSGIDebugGUI"

const gui = new SSGIDebugGUI(ssgiEffect, options)
```

That's it, you should now have the GUI you can see in the example scene. The `options` parameter is optional for the SSGIDebugGUI and will default to the default options if no `options` parameter is given.

## Run Locally

If you'd like to test this project and run it locally, run these commands:

```shell
git clone https://github.com/0beqz/realism-effects
cd realism-effects/example
npm i --force
npm run dev
```

## Sponsoring

If the project is useful for you and you'd like to sponsor my work:

[GitHub Sponsors](https://github.com/sponsors/0beqz)

If you'd like, you could also buy me a coffee:

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/0beqz)

## Todos

- [ ] Use bent normals and/or calculate them at run-time? https://80.lv/articles/ssrtgi-toughest-challenge-in-real-time-3d/
- [ ] Proper transparency support
- [ ] Support OrthographicCameras

## Credits

- SSR code: [Screen Space Reflections on Epsilon Engine](https://imanolfotia.com/blog/1)

- Edge fade for SSR: [kode80](http://kode80.com/blog/)

- Velocity Shader: [three.js sandbox](https://github.com/gkjohnson/threejs-sandbox)

### Demo Scene

- Mercedes-Benz AMG-GT 2015: [Márcio Meireles](https://sketchfab.com/marciomeireles)
- 2019 Chevrolet Corvette C8 Stingray: [Hari](https://sketchfab.com/Hari31)
- Clay Bust Study: [lomepawol](https://sketchfab.com/lomepawol)
- Cyberpunk Bike: [Roman Red](https://sketchfab.com/OFFcours1)
- Cyber Samurai: [KhoaMinh](https://sketchfab.com/duongminhkhoa231)
- Darth Vader: [Brad Groatman](https://sketchfab.com/groatman)
- Flashbang Grenade: [Nikolay Kudrin](https://sketchfab.com/knik211)
- SPY-HYPERSPORT Motorbike: [Amvall](https://sketchfab.com/Amvall.Vall)
- Laocoon and His Sons Statue: [Rigsters](https://sketchfab.com/rigsters)
- Squid Game PinkSoldier: [Jaeysart](https://sketchfab.com/jaeysart)
- Berserk Guts Black Swordsman: [gimora](https://sketchfab.com/gimora)
- Time Machine (from TRAA demo scene): [vertexmonster](https://sketchfab.com/vertexmonster)

## Resources

### Tracing in screen-space

- [Rendering view dependent reflections using the graphics card](https://kola.opus.hbz-nrw.de/opus45-kola/frontdoor/deliver/index/docId/908/file/BA_GuidoSchmidt.pdf)

- [Screen Space Reflections in Unity 5](http://www.kode80.com/blog/2015/03/11/realism-effects-in-unity-5/)

- [Screen Space Glossy Reflections](http://roar11.com/2015/07/screen-space-glossy-reflections/)

- [Screen Space Reflection (SSR)](https://lettier.github.io/3d-game-shaders-for-beginners/screen-space-reflection.html)

- [Approximating ray traced reflections using screenspace data](https://publications.lib.chalmers.se/records/fulltext/193772/193772.pdf)

- [Screen Space Reflection Techniques](https://ourspace.uregina.ca/bitstream/handle/10294/9245/Beug_Anthony_MSC_CS_Spring2020.pdf)

- [Shiny Pixels and Beyond: Real-Time Raytracing at SEED](https://media.contentapi.ea.com/content/dam/ea/seed/presentations/dd18-seed-raytracing-in-hybrid-real-time-rendering.pdf)

- [DD2018: Tomasz Stachowiak - Stochastic all the things: raytracing in hybrid real-time rendering (YouTube)](https://www.youtube.com/watch?v=MyTOGHqyquU)

- [Real-Time Reflections in Mafia III and Beyond](https://ubm-twvideo01.s3.amazonaws.com/o1/vault/gdc2018/presentations/Sobek_Martin_Real-time_Reflections_in_MafiaIII.pdf)

### Temporal Reprojection

- [Temporal Reprojection Anti-Aliasing in INSIDE](http://s3.amazonaws.com/arena-attachments/655504/c5c71c5507f0f8bf344252958254fb7d.pdf?1468341463)

- [Reprojecting Reflections](http://bitsquid.blogspot.com/2017/06/reprojecting-reflections_22.html)

- [Temporal AA (Unreal Engine 4)](https://de45xmedrsdbp.cloudfront.net/Resources/files/TemporalAA_small-59732822.pdf)

- [Temporally Reliable Motion Vectors for Real-time Ray Tracing](https://sites.cs.ucsb.edu/~lingqi/publications/paper_trmv.pdf)

- [Temporal AA and the quest for the Holy Trail](https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/)

- [Visibility TAA and Upsampling with Subsample History](http://filmicworlds.com/blog/visibility-taa-and-upsampling-with-subsample-history/)

- [Temporal Anti Aliasing – Step by Step](https://ziyadbarakat.wordpress.com/2020/07/28/temporal-anti-aliasing-step-by-step/)

- [Filmic SMAA: Sharp Morphological and Temporal Antialiasing](https://research.activision.com/publications/archives/filmic-smaasharp-morphological-and-temporal-antialiasing)

### HBAO

- [Horizon-Based Indirect Lighting (HBIL)](https://drive.google.com/file/d/1fmceYuM5J2s8puNHZ9o4OF3YjqzIvmRR/view)
- [Pyramid HBAO — a Scalable Horizon-based Ambient Occlusion Method](https://ceur-ws.org/Vol-3027/paper5.pdf)
