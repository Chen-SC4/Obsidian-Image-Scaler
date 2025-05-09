# Obsidian Image Scaler

This plugin allows you to scale images by dragging the edge of the image with your mouse. When dragging, the original image link format will be converted to the universal `<img/>` tag format.

## Eamples

`![Alt Text](Image.jpg) -> <img src="Image.jpg" alt="Alt Text" style="zoom: 100%" />`

![Before Dragging](images/DraggingExample1.gif)

`![Alt Text|W](Image.jpg) -> <img src="Image.jpg" alt="Alt Text" style="zoom: 100%; width: [W]px" />`

![](images/DraggingExample2.gif)

`![Alt Text|WxH](Image.jpg) -> <img src="Image.jpg" alt="Alt Text" style="zoom: 100%; width: [W]px; height: [H]px" />`

![](images/DraggingExample3.gif)

`![[Image.jpg|WxH]] -> <img src="Image.jpg" alt="Alt Text" style="zoom: 100%; width: [W]px; height: [H]px" />`

![](images/DraggingExample4.gif)
