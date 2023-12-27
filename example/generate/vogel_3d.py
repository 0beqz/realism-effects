import numpy

n = 64

golden_angle = numpy.pi * (3 - numpy.sqrt(5))
theta = golden_angle * numpy.arange(n)
z = numpy.linspace(1 - 1.0 / n, 1.0 / n - 1, n)
radius = numpy.sqrt(1 - z * z)

points = numpy.zeros((n, 3))
points[:, 0] = radius * numpy.cos(theta)
points[:, 1] = radius * numpy.sin(theta)
points[:, 2] = z

# visualize points with matplotlib
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D

fig = plt.figure()
ax = fig.add_subplot(1, 1, 1, projection="3d")
ax.scatter(points[:, 0], points[:, 1], points[:, 2])
plt.show()

# we want to print points as a glsl array of vec3
points_json = "vec3[](\n"
for point in points:
    points_json += "  vec3(%f, %f, %f),\n" % (point[0], point[1], point[2])

# delete last comma
points_json = points_json[:-2]

points_json += ");\n"

print(points_json)
