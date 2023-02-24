import glsl from "vite-plugin-glsl"
import { defineConfig } from "vite"
import wasm from "vite-plugin-wasm"
import topLevelAwait from "vite-plugin-top-level-await"

export default defineConfig({
	plugins: [wasm(), topLevelAwait(), glsl()],
	resolve: {
		alias: [
			{ find: "traa", replacement: "../src/index.js" },
			{ find: "three", replacement: __dirname + "/node_modules/three" },
			{ find: "postprocessing", replacement: __dirname + "/node_modules/postprocessing" }
		]
	},
	server: {
		fs: {
			allow: [".."]
		}
	}
})
