window.onload = () => {
    const ENV = {};

     (function loadEnv() {
         /**
          * @type {{
          *     loadFrom: "json"|"local",
          *     editor: boolean,
          *     }}
          */
         const defaults = {
             loadFrom: "json",
             editor: false
         }
         let env = JSON.parse(localStorage.getItem("env")) ?? null
         for (let [key, dValue] of Object.entries(defaults)){
             let value = (env != null ? env[key] : null)
             ENV[key] = (value != null ? value : dValue)
         }
     })()

    // Since 2.2 you can also author concise templates with method chaining instead of GraphObject.make
    // For details, see https://gojs.net/latest/intro/buildingObjects.html
    const $ = go.GraphObject.make;

     let diagramConf =  {
         padding: 20,
         "toolManager.mouseWheelBehavior": go.ToolManager.WheelZoom,
         "undoManager.isEnabled": true
     }

     let nodeConf =  {
         locationSpot: go.Spot.Center,
     }

    let Diagram =
        $(go.Diagram, "blockDiagram", diagramConf);

     const fn = {};
     if (ENV.editor){
         Object.assign(diagramConf, {

             grid: $(go.Panel, "Grid",
                 $(go.Shape, "LineH", {stroke: "lightgray", strokeWidth: 0.2}),
                 $(go.Shape, "LineV", {stroke: "lightgray", strokeWidth: 0.2})
             ),
             "draggingTool.isGridSnapEnabled": true,

             handlesDragDropForTopLevelParts: true,
             mouseDrop: e => {
                 // when the selection is dropped in the diagram's background,
                 // make sure the selected Parts no longer belong to any Group
                 var ok = e.diagram.commandHandler.addTopLevelParts(e.diagram.selection, true);
                 if (!ok) e.diagram.currentTool.doCancel();
             },
             commandHandler: $(DrawCommandHandler),  // support offset copy-and-paste
             "clickCreatingTool.archetypeNodeData": {text: "NEW NODE"},  // create a new node by double-clicking in background
             "PartCreated": e => {
                 var node = e.subject;  // the newly inserted Node -- now need to snap its location to the grid
                 node.location = node.location.copy().snapToGridPoint(e.diagram.grid.gridOrigin, e.diagram.grid.gridCellSize);
                 setTimeout(() => {  // and have the user start editing its text
                     e.diagram.commandHandler.editTextBlock();
                 }, 20);
             },
             "commandHandler.archetypeGroupData": {isGroup: true, text: "NEW GROUP"},
             "SelectionGrouped": e => {
                 var group = e.subject;
                 setTimeout(() => {  // and have the user start editing its text
                     e.diagram.commandHandler.editTextBlock();
                 })
             },
             "LinkRelinked": e => {
                 // re-spread the connections of other links connected with both old and new nodes
                 var oldnode = e.parameter.part;
                 oldnode.invalidateConnectedLinks();
                 var link = e.subject;
                 if (e.diagram.toolManager.linkingTool.isForwards) {
                     link.toNode.invalidateConnectedLinks();
                 } else {
                     link.fromNode.invalidateConnectedLinks();
                 }
             },
         })
         Object.assign(nodeConf, {
             locationObjectName: "SHAPE",
             desiredSize: new go.Size(100, 40), minSize: new go.Size(40, 40),
             resizable: true, resizeCellSize: new go.Size(20, 20)
         })

         Object.assign(fn, {

             // Node selection adornment
             // Include four large triangular buttons so that the user can easily make a copy
             // of the node, move it to be in that direction relative to the original node,
             // and add a link to the new node.
             makeArrowButton(spot, fig) {
                 var maker = (e, shape) => {
                     e.handled = true;
                     e.diagram.model.commit(m => {
                         var selnode = shape.part.adornedPart;
                         // create a new node in the direction of the spot
                         var p = new go.Point().setRectSpot(selnode.actualBounds, spot);
                         p.subtract(selnode.location);
                         p.scale(2, 2);
                         p.x += Math.sign(p.x) * 60;
                         p.y += Math.sign(p.y) * 60;
                         p.add(selnode.location);
                         p.snapToGridPoint(e.diagram.grid.gridOrigin, e.diagram.grid.gridCellSize);
                         // make the new node a copy of the selected node
                         var nodedata = m.copyNodeData(selnode.data);
                         // add to same group as selected node
                         m.setGroupKeyForNodeData(nodedata, m.getGroupKeyForNodeData(selnode.data));
                         m.addNodeData(nodedata);  // add to model
                         // create a link from the selected node to the new node
                         var linkdata = {from: selnode.key, to: m.getKeyForNodeData(nodedata)};
                         m.addLinkData(linkdata);  // add to model
                         // move the new node to the computed location, select it, and start to edit it
                         var newnode = e.diagram.findNodeForData(nodedata);
                         newnode.location = p;
                         e.diagram.select(newnode);
                         setTimeout(() => {
                             e.diagram.commandHandler.editTextBlock();
                         }, 20);
                     });
                 };
                 return $(go.Shape,
                     {
                         figure: fig,
                         alignment: spot, alignmentFocus: spot.opposite(),
                         width: (spot.equals(go.Spot.Top) || spot.equals(go.Spot.Bottom)) ? 36 : 18,
                         height: (spot.equals(go.Spot.Top) || spot.equals(go.Spot.Bottom)) ? 18 : 36,
                         fill: "orange", strokeWidth: 0,
                         isActionable: true,  // needed because it's in an Adornment
                         click: maker, contextClick: maker
                     });
             },
             // create a button that brings up the context menu
             CMButton(options) {
                 return $(go.Shape,
                     {
                         fill: "orange", stroke: "gray", background: "transparent",
                         geometryString: "F1 M0 0 M0 4h4v4h-4z M6 4h4v4h-4z M12 4h4v4h-4z M0 12",
                         isActionable: true, cursor: "context-menu",
                         click: (e, shape) => {
                             e.diagram.commandHandler.showContextMenu(shape.part.adornedPart);
                         }
                     },
                     options || {});
             },

             // Common context menu button definitions
             // All buttons in context menu work on both click and contextClick,
             // in case the user context-clicks on the button.
             // All buttons modify the node data, not the Node, so the Bindings need not be TwoWay.

             // A button-defining helper function that returns a click event handler.
             // PROPNAME is the name of the data property that should be set to the given VALUE.
             ClickFunction(propname, value) {
                 return (e, obj) => {
                     e.handled = true;  // don't let the click bubble up
                     e.diagram.model.commit(m => {
                         m.set(obj.part.adornedPart.data, propname, value);
                     });
                 };
             },

             // Create a context menu button for setting a data property with a color value.
             ColorButton(color, propname) {
                 if (!propname) propname = "color";
                 return $(go.Shape,
                     {
                         width: 16, height: 16, stroke: "lightgray", fill: color,
                         margin: 1, background: "transparent",
                         mouseEnter: (e, shape) => shape.stroke = "dodgerblue",
                         mouseLeave: (e, shape) => shape.stroke = "lightgray",
                         click: fn.ClickFunction(propname, color), contextClick: fn.ClickFunction(propname, color)
                     });
             },
             LightFillButtons() {  // used by multiple context menus
                 return [
                     $("ContextMenuButton",
                         $(go.Panel, "Horizontal",
                             fn.ColorButton("white", "fill"), fn.ColorButton("beige", "fill"), fn.ColorButton("aliceblue", "fill"), fn.ColorButton("lightyellow", "fill")
                         )
                     ),
                     $("ContextMenuButton",
                         $(go.Panel, "Horizontal",
                             fn.ColorButton("lightgray", "fill"), fn.ColorButton("lightgreen", "fill"), fn.ColorButton("lightblue", "fill"), fn.ColorButton("pink", "fill")
                         )
                     )
                 ];
             },
             DarkColorButtons() {  // used by multiple context menus
                 return [
                     $("ContextMenuButton",
                         $(go.Panel, "Horizontal",
                             fn.ColorButton("black"), fn.ColorButton("green"), fn.ColorButton("blue"), fn.ColorButton("red")
                         )
                     ),
                     $("ContextMenuButton",
                         $(go.Panel, "Horizontal",
                             fn.ColorButton("brown"), fn.ColorButton("magenta"), fn.ColorButton("purple"), fn.ColorButton("orange")
                         )
                     )
                 ];
             },

             // Create a context menu button for setting a data property with a stroke width value.
             ThicknessButton(sw, propname) {
                 if (!propname) propname = "thickness";
                 return $(go.Shape, "LineH",
                     {
                         width: 16, height: 16, strokeWidth: sw,
                         margin: 1, background: "transparent",
                         mouseEnter: (e, shape) => shape.background = "dodgerblue",
                         mouseLeave: (e, shape) => shape.background = "transparent",
                         click: fn.ClickFunction(propname, sw), contextClick: fn.ClickFunction(propname, sw)
                     });
             },
             // Create a context menu button for setting a data property with a stroke dash Array value.
             DashButton(dash, propname) {
                 if (!propname) propname = "dash";
                 return $(go.Shape, "LineH",
                     {
                         width: 24, height: 16, strokeWidth: 2,
                         strokeDashArray: dash,
                         margin: 1, background: "transparent",
                         mouseEnter: (e, shape) => shape.background = "dodgerblue",
                         mouseLeave: (e, shape) => shape.background = "transparent",
                         click: fn.ClickFunction(propname, dash), contextClick: fn.ClickFunction(propname, dash)
                     });
             },
             StrokeOptionsButtons() {  // used by multiple context menus
                 return [
                     $("ContextMenuButton",
                         $(go.Panel, "Horizontal",
                             fn.ThicknessButton(1), fn.ThicknessButton(2), fn.ThicknessButton(3), fn.ThicknessButton(4)
                         )
                     ),
                     $("ContextMenuButton",
                         $(go.Panel, "Horizontal",
                             fn.DashButton(null), fn.DashButton([2, 4]), fn.DashButton([4, 4])
                         )
                     )
                 ];
             },
             FigureButton(fig, propname) {
                 if (!propname) propname = "figure";
                 return $(go.Shape,
                     {
                         width: 32, height: 32, scale: 0.5, fill: "lightgray", figure: fig,
                         margin: 1, background: "transparent",
                         mouseEnter: (e, shape) => shape.fill = "dodgerblue",
                         mouseLeave: (e, shape) => shape.fill = "lightgray",
                         click: fn.ClickFunction(propname, fig), contextClick: fn.ClickFunction(propname, fig)
                     });
             },


             // Link context menu
             // All buttons in context menu work on both click and contextClick,
             // in case the user context-clicks on the button.
             // All buttons modify the link data, not the Link, so the Bindings need not be TwoWay.
             ArrowButton(num) {
                 var geo = "M0 0 M16 16 M0 8 L16 8  M12 11 L16 8 L12 5";
                 if (num === 0) {
                     geo = "M0 0 M16 16 M0 8 L16 8";
                 } else if (num === 2) {
                     geo = "M0 0 M16 16 M0 8 L16 8  M12 11 L16 8 L12 5  M4 11 L0 8 L4 5";
                 }
                 return $(go.Shape,
                     {
                         geometryString: geo,
                         margin: 2, background: "transparent",
                         mouseEnter: (e, shape) => shape.background = "dodgerblue",
                         mouseLeave: (e, shape) => shape.background = "transparent",
                         click: fn.ClickFunction("dir", num), contextClick: fn.ClickFunction("dir", num)
                     });
             },
             AllSidesButton(to) {
                 var setter = (e, shape) => {
                     e.handled = true;
                     e.diagram.model.commit(m => {
                         var link = shape.part.adornedPart;
                         m.set(link.data, (to ? "toSpot" : "fromSpot"), go.Spot.stringify(go.Spot.AllSides));
                         // re-spread the connections of other links connected with the node
                         (to ? link.toNode : link.fromNode).invalidateConnectedLinks();
                     });
                 };
                 return $(go.Shape,
                     {
                         width: 12, height: 12, fill: "transparent",
                         mouseEnter: (e, shape) => shape.background = "dodgerblue",
                         mouseLeave: (e, shape) => shape.background = "transparent",
                         click: setter, contextClick: setter
                     });
             },
             SpotButton(spot, to) {
                 var ang = 0;
                 var side = go.Spot.RightSide;
                 if (spot.equals(go.Spot.Top)) {
                     ang = 270;
                     side = go.Spot.TopSide;
                 } else if (spot.equals(go.Spot.Left)) {
                     ang = 180;
                     side = go.Spot.LeftSide;
                 } else if (spot.equals(go.Spot.Bottom)) {
                     ang = 90;
                     side = go.Spot.BottomSide;
                 }
                 if (!to) ang -= 180;
                 var setter = (e, shape) => {
                     e.handled = true;
                     e.diagram.model.commit(m => {
                         var link = shape.part.adornedPart;
                         m.set(link.data, (to ? "toSpot" : "fromSpot"), go.Spot.stringify(side));
                         // re-spread the connections of other links connected with the node
                         (to ? link.toNode : link.fromNode).invalidateConnectedLinks();
                     });
                 };
                 return $(go.Shape,
                     {
                         alignment: spot, alignmentFocus: spot.opposite(),
                         geometryString: "M0 0 M12 12 M12 6 L1 6 L4 4 M1 6 L4 8",
                         angle: ang,
                         background: "transparent",
                         mouseEnter: (e, shape) => shape.background = "dodgerblue",
                         mouseLeave: (e, shape) => shape.background = "transparent",
                         click: setter, contextClick: setter
                     });
             },
         })
     }


    // Node template
    Diagram.nodeTemplate =
        $(go.Node, "Auto", nodeConf,
            // these Bindings are TwoWay because the DraggingTool and ResizingTool modify the target properties
            new go.Binding("location", "loc", go.Point.parse).makeTwoWay(go.Point.stringify),
            new go.Binding("desiredSize", "size", go.Size.parse).makeTwoWay(go.Size.stringify),
            $(go.Shape, "RoundedRectangle",
                { // the border
                    name: "SHAPE", fill: "white",
                    portId: "", cursor: "pointer",
                    fromLinkable: true, toLinkable: true,
                    fromLinkableDuplicates: true, toLinkableDuplicates: true,
                    fromSpot: go.Spot.AllSides, toSpot: go.Spot.AllSides
                },
                new go.Binding("figure"),
                new go.Binding("fill"),
                new go.Binding("stroke", "color"),
                new go.Binding("strokeWidth", "thickness"),
                new go.Binding("strokeDashArray", "dash")),
            // this Shape prevents mouse events from reaching the middle of the port
            $(go.Shape, {width: 100, height: 40, strokeWidth: 0, fill: "transparent"}),
            $(go.TextBlock,
                {margin: 1, textAlign: "center", overflow: go.TextBlock.OverflowEllipsis, editable: ENV.editor},
                // this Binding is TwoWay due to the user editing the text with the TextEditingTool
                new go.Binding("text").makeTwoWay(),
                new go.Binding("stroke", "color"))
        );



    Diagram.nodeTemplate.toolTip =
        $("ToolTip",  // show some detailed information
            $(go.Panel, "Vertical",
                {maxSize: new go.Size(200, NaN)},  // limit width but not height
                $(go.TextBlock,
                    {font: "bold 10pt sans-serif", textAlign: "center"},
                    new go.Binding("text")),
                $(go.TextBlock,
                    {font: "10pt sans-serif", textAlign: "center"},
                    new go.Binding("text", "details"))
            )
        );


    // Group template

    Diagram.groupTemplate =
        $(go.Group, "Spot",
            {
                layerName: "Background",
                ungroupable: true,
                locationSpot: go.Spot.Center,
                selectionObjectName: "BODY",
                computesBoundsAfterDrag: true,  // allow dragging out of a Group that uses a Placeholder
                handlesDragDropForMembers: true,  // don't need to define handlers on Nodes and Links
                mouseDrop: (e, grp) => {  // add dropped nodes as members of the group
                    var ok = grp.addMembers(grp.diagram.selection, true);
                    if (!ok) grp.diagram.currentTool.doCancel();
                },
                avoidable: false
            },
            new go.Binding("location", "loc", go.Point.parse).makeTwoWay(go.Point.stringify),
            $(go.Panel, "Auto",
                {name: "BODY"},
                $(go.Shape,
                    {
                        parameter1: 10,
                        fill: "white", strokeWidth: 1, strokeDashArray: [4, 4],
                        portId: "", cursor: "pointer",
                        fromLinkable: true, toLinkable: true,
                        fromLinkableDuplicates: true, toLinkableDuplicates: true,
                        fromSpot: go.Spot.AllSides, toSpot: go.Spot.AllSides
                    },
                    new go.Binding("fill"),
                    new go.Binding("stroke", "color"),
                    new go.Binding("strokeWidth", "thickness"),
                    new go.Binding("strokeDashArray", "dash")),
                $(go.Placeholder,
                    {background: "transparent", margin: 10})
            ),
            $(go.TextBlock,
                {
                    alignment: go.Spot.Top, alignmentFocus: go.Spot.Bottom,
                    font: "bold 12pt sans-serif", editable: true
                },
                new go.Binding("text"),
                new go.Binding("stroke", "color"))
        );

    Diagram.groupTemplate.selectionAdornmentTemplate =
        $(go.Adornment, "Spot",
            $(go.Panel, "Auto",
                $(go.Shape, {fill: null, stroke: "dodgerblue", strokeWidth: 3}),
                $(go.Placeholder, {margin: 1.5})
            ),

        );


    // Link template

    Diagram.linkTemplate =
        $(go.Link, go.Link.Bezier,
            {
                layerName: "Foreground",
                routing: go.Link.AvoidsNodes, corner: 10,
                toShortLength: 4,  // assume arrowhead at "to" end, need to avoid bad appearance when path is thick
                relinkableFrom: true, relinkableTo: true,
                reshapable: true, resegmentable: true
            },
            new go.Binding("fromSpot", "fromSpot", go.Spot.parse),
            new go.Binding("toSpot", "toSpot", go.Spot.parse),
            new go.Binding("fromShortLength", "dir", dir => dir === 2 ? 4 : 0),
            new go.Binding("toShortLength", "dir", dir => dir >= 1 ? 4 : 0),
            new go.Binding("points").makeTwoWay(),  // TwoWay due to user reshaping with LinkReshapingTool
            $(go.Shape, {strokeWidth: 2},
                new go.Binding("stroke", "color"),
                new go.Binding("strokeWidth", "thickness"),
                new go.Binding("strokeDashArray", "dash")),
            $(go.Shape, {fromArrow: "Backward", strokeWidth: 0, scale: 4 / 3, visible: false},
                new go.Binding("visible", "dir", dir => dir === 2),
                new go.Binding("fill", "color"),
                new go.Binding("scale", "thickness", t => (2 + t) / 3)),
            $(go.Shape, {toArrow: "Standard", strokeWidth: 0, scale: 4 / 3},
                new go.Binding("visible", "dir", dir => dir >= 1),
                new go.Binding("fill", "color"),
                new go.Binding("scale", "thickness", t => (2 + t) / 3)),
            $(go.Panel, "Auto",
                $(go.Shape,  // the label background, which becomes transparent around the edges
                    {
                        fill: "transparent"/*$(go.Brush, "Radial",
                            {0: "rgb(240, 240, 240)", 1: "rgba(240, 240, 240, .5)"})*/,
                        stroke: null
                    }),
                $(go.TextBlock,
                    {alignmentFocus: new go.Spot(0, 1, -4, 0), editable: true, text: ""},
                    new go.Binding("text").makeTwoWay(),  // TwoWay due to user editing with TextEditingTool
                    new go.Binding("stroke", "color"))
            ),
        );

    Diagram.linkTemplate.selectionAdornmentTemplate =
        $(go.Adornment,  // use a special selection Adornment that does not obscure the link path itself
            $(go.Shape,
                { // this uses a pathPattern with a gap in it, in order to avoid drawing on top of the link path Shape
                    isPanelMain: true,
                    stroke: "transparent", strokeWidth: 6,
                    pathPattern: makeAdornmentPathPattern(2)  // == thickness or strokeWidth
                },
                new go.Binding("pathPattern", "thickness", makeAdornmentPathPattern))
        );


    function makeAdornmentPathPattern(w) {
        return $(go.Shape,
            {
                stroke: "dodgerblue", strokeWidth: 2, strokeCap: "square",
                geometryString: "M0 0 M4 2 H3 M4 " + (w + 4).toString() + " H3"
            });
    }





    if (ENV.editor){
        Diagram.nodeTemplate.selectionAdornmentTemplate =
            $(go.Adornment, "Spot",
                $(go.Placeholder, {padding: 10}),
                fn.makeArrowButton(go.Spot.Top, "TriangleUp"),
                fn.makeArrowButton(go.Spot.Left, "TriangleLeft"),
                fn.makeArrowButton(go.Spot.Right, "TriangleRight"),
                fn.makeArrowButton(go.Spot.Bottom, "TriangleDown"),
                fn.CMButton({alignment: new go.Spot(0.75, 0)})
            );

        Diagram.nodeTemplate.contextMenu =
            $("ContextMenu",
                $("ContextMenuButton",
                    $(go.Panel, "Horizontal",
                        fn.FigureButton("Rectangle"), fn.FigureButton("RoundedRectangle"), fn.FigureButton("Ellipse"), fn.FigureButton("Diamond")
                    )
                ),
                $("ContextMenuButton",
                    $(go.Panel, "Horizontal",
                        fn.FigureButton("Parallelogram2"), fn.FigureButton("ManualOperation"), fn.FigureButton("Procedure"), fn.FigureButton("Cylinder1")
                    )
                ),
                $("ContextMenuButton",
                    $(go.Panel, "Horizontal",
                        fn.FigureButton("Terminator"), fn.FigureButton("CreateRequest"), fn.FigureButton("Document"), fn.FigureButton("TriangleDown")
                    )
                ),
                fn.LightFillButtons(),
                fn.DarkColorButtons(),
                fn.StrokeOptionsButtons()
            );


        Diagram.groupTemplate.selectionAdornmentTemplate.add(
            fn.CMButton({alignment: go.Spot.TopRight, alignmentFocus: go.Spot.BottomRight})
        )

        Diagram.groupTemplate.contextMenu =
            $("ContextMenu",
                fn.LightFillButtons(),
                fn.DarkColorButtons(),
                fn.StrokeOptionsButtons()
            );

        Diagram.linkTemplate.contextMenu =
            $("ContextMenu",
                fn.DarkColorButtons(),
                fn.StrokeOptionsButtons(),
                $("ContextMenuButton",
                    $(go.Panel, "Horizontal",
                        fn.ArrowButton(0), fn.ArrowButton(1), fn.ArrowButton(2)
                    )
                ),
                $("ContextMenuButton",
                    $(go.Panel, "Horizontal",
                        $(go.Panel, "Spot",
                            fn.AllSidesButton(false),
                            fn.SpotButton(go.Spot.Top, false), fn.SpotButton(go.Spot.Left, false), fn.SpotButton(go.Spot.Right, false), fn.SpotButton(go.Spot.Bottom, false)
                        ),
                        $(go.Panel, "Spot",
                            {margin: new go.Margin(0, 0, 0, 2)},
                            fn.AllSidesButton(true),
                            fn.SpotButton(go.Spot.Top, true), fn.SpotButton(go.Spot.Left, true), fn.SpotButton(go.Spot.Right, true), fn.SpotButton(go.Spot.Bottom, true)
                        )
                    )
                )
            );

        Diagram.linkTemplate.selectionAdornmentTemplate.add(
            fn.CMButton({alignmentFocus: new go.Spot(0, 0, -6, -4)})
        )
    }

    window.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.code === "KeyS") {
            e.preventDefault()
            save()
        }
    })


    function save() {
        localStorage.setItem("model",
            Diagram.model.toJson()
        )
        Diagram.isModified = false;
    }

    function load() {
        fetch('./data.json')
            .then((response) => response.json())
            .then((json) => {
                if (json.length === 0) {
                    loadFromLocal()
                } else {
                    Diagram.model = go.Model.fromJson(json);
                }
            });
    }

    function loadFromLocal() {
        Diagram.model = go.Model.fromJson(localStorage.getItem("model"));
    }

    switch (ENV.loadFrom) {
        case "json": {
            load();
            break
        }
        case "local": {
            loadFromLocal()
            setInterval(() => {
                save()
            }, 60 * 1000)
        }
    }

    window.d = Diagram
}