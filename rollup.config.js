import { babel } from "@rollup/plugin-babel"
import image from "@rollup/plugin-image"
import resolve from "@rollup/plugin-node-resolve"
import path from "path"
import glslify from "rollup-plugin-glslify"

// eslint-disable-next-line no-undef
const root = process.platform === "win32" ? path.resolve("/") : "/"
const external = id => !id.startsWith(".") && !id.startsWith(root)
const extensions = [".js", ".jsx", ".ts", ".tsx", ".json"]

const getBabelOptions = ({ useESModules }) => ({
	babelrc: false,
	extensions,
	exclude: "**/node_modules/**",
	babelHelpers: "runtime",
	presets: [
		[
			"@babel/preset-env",
			{
				include: [
					"@babel/plugin-proposal-optional-chaining",
					"@babel/plugin-proposal-nullish-coalescing-operator",
					"@babel/plugin-proposal-numeric-separator",
					"@babel/plugin-proposal-logical-assignment-operators",
					"@babel/plugin-proposal-private-methods",
					"@babel/plugin-proposal-class-properties"
				],
				bugfixes: true,
				loose: true,
				modules: false,
				targets: "> 1%, not dead, not ie 11, not op_mini all"
			}
		]
	],
	plugins: [
		"@babel/plugin-proposal-nullish-coalescing-operator",
		["@babel/transform-runtime", { regenerator: false, useESModules }]
	]
})

export default [
	{
		input: "./src/index.js",
		output: { file: "dist/index.js", format: "esm" },
		external,
		plugins: [glslify(), image(), babel(getBabelOptions({ useESModules: true })), resolve({ extensions })]
	},
	{
		input: "./src/index.js",
		output: { file: "dist/index.cjs", format: "cjs" },
		external,
		plugins: [glslify(), image(), babel(getBabelOptions({ useESModules: false })), resolve({ extensions })]
	}
]
