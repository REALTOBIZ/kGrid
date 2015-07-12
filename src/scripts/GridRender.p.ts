export class GridRender implements Fundamental.IFeature, Fundamental.IDisposable {
    public disposer;
    private _runtime;
    private _invoke;
    private _elements;
    private _uiValues;
    private _renderingScheduler;
    private _layoutStylesheetUpdater;
    private _cellStylesheetUpdater;
    private _updaters;
    private _renderRange;
    private _viewportScrollCoordinate;

    public constructor() {
        this.disposer = new Fundamental.Disposer(() => {
            this._runtime = null;
            this._invoke = null;
            this._elements = null;
            this._uiValues = null;
            this._renderingScheduler = null;
            this._layoutStylesheetUpdater = null;
            this._cellStylesheetUpdater = null;
            this._updaters = null;
            this._viewportScrollCoordinate = null;
        });
    }

    public dispose() {
        this.disposer.dispose();
    }

    public initialize(runtime, $invoke) {
        this._runtime = runtime;
        this._invoke = $invoke;
        this._renderRange = Range.Null;
        this._viewportScrollCoordinate = new Microsoft.Office.Controls.Fundamental.Coordinate(Microsoft.Office.Controls.Fundamental.CoordinateType.ViewportRelative, 0, 0),
        this.disposer.addDisposable(this._renderingScheduler = new Fundamental.RenderingScheduler());
        this.disposer.addDisposable(this._updaters = new Fundamental.UpdaterGroup());

        this.disposer.addDisposable(this._layoutStylesheetUpdater = new Fundamental.DynamicStylesheetUpdater('msoc-list-render-layout-' + this._runtime.id));
        this._layoutStylesheetUpdater.add(() => this._getLayoutStylesheet());
        this._updaters.add(this._layoutStylesheetUpdater.getUpdater());

        this.disposer.addDisposable(this._cellStylesheetUpdater = new Fundamental.DynamicStylesheetUpdater('msoc-list-render-cell-' + this._runtime.id));
        this._cellStylesheetUpdater.add(() => this._getCellStylesheet());
        this._updaters.add(this._cellStylesheetUpdater.getUpdater());

        this._updaters.add(this._getRenderRangeUpdater());

        var renderContext = {
            headerCells: [],
            renderedRows: [],
        };

        this._renderingScheduler.addWorker((context) => this._renderHeaderCellWorker(context), renderContext, 800);
        this._renderingScheduler.addWorker((context) => this._renderCellWorker(context), renderContext, 1000);
        this.disposer.addDisposable(
            new Fundamental.EventAttacher(
                this._runtime.events,
                'propertyChange',
                (sender, args) => {
                    if (args.name == 'width' || args.name == 'height') {
                        this._updateUIValues();
                        this._updaters.update();
                    }
            }));

        this.disposer.addDisposable(
            new Fundamental.EventAttacher(
                this._runtime.dataContexts.columnsDataContext,
                'visibleColumnIdsChange',
                (sender, args) => {
                    this._updateUIValues();
                    this._updaters.update();
            }));

        this.disposer.addDisposable(
            new Fundamental.EventAttacher(
                this._runtime.dataContexts.rowsDataContext,
                'rowCountChange',
                (sender, args) => {
                    this._updateUIValues();
                    this._updaters.update();
            }));

        var root = $(
            '<div class="msoc-list ' + runtime.rootClass + '" tabindex="0" aria-labelledby="msocListScreenReader_' + runtime.id + '">' +
                '<div id="msocListScreenReader_' + runtime.id + '" class="msoc-list-screen-reader" aria-live="assertive"></div>' +
                '<div class="msoc-list-header-viewport">' +
                    '<div class="msoc-list-canvas-container">' +
                        '<div class="msoc-list-canvas"></div>' +
                        '<div class="msoc-list-canvas"></div>' +
                        '<div class="msoc-list-canvas"></div>' +
                    '</div>' +
                '</div>' +
                '<div class="msoc-list-content-viewport">' +
                    '<div class="msoc-list-canvas-container">' +
                        '<div class="msoc-list-canvas"></div>' +
                        '<div class="msoc-list-canvas"></div>' +
                        '<div class="msoc-list-canvas"></div>' +
                    '</div>' +
                '</div>' +
            '</div>');

        var container = $(this._runtime.container);

        container.html('');
        container.append(root);

        var header = root.find('>.msoc-list-header-viewport'),
            content = root.find('>.msoc-list-content-viewport');

        this._elements = {
            root: root[0],
            header: {
                viewport: header[0],
                container: header.find('>.msoc-list-canvas-container')[0],
                canvas: header.find('.msoc-list-canvas')[0],
                mainCanvas: header.find('.msoc-list-canvas')[1],
            },
            content: {
                viewport: content[0],
                container: content.find('>.msoc-list-canvas-container')[0],
                canvas: content.find('.msoc-list-canvas')[0],
                mainCanvas: content.find('.msoc-list-canvas')[1],
            },
        };

        this._updateUIValues();
        this._updaters.update();
        this._renderingScheduler.start(true);
    }

    public name() {
        return 'GridRender';
    }

    private _updateUIValues() {
        var viewport = $(this._elements.content.viewport);
        var canvas = $(this._elements.content.canvas);

        this._uiValues = {
            content: {
                viewport: {
                    width: viewport.width(),
                    height: viewport.height(),
                    clientWidth: viewport[0].clientWidth,
                    clientHeight: viewport[0].clientHeight,
                },
                canvas: {
                    width: canvas.width(),
                    height: canvas.height(),
                }
            },
        };
    }

    private _getColumnWidthById(columnId) {
        var width = this._runtime.dataContexts.columnsDataContext.getColumnById(columnId).width;

        // FIXME: default column width
        return isNaN(width) || width < 0 ? 50 : width;
    }

    private _calculateCanvasRect() {
        var visibleColumnIds = this._runtime.dataContexts.columnsDataContext.visibleColumnIds(),
            rowHeight = this._runtime.theme.value('table.rowHeight'),
            rowCount = this._runtime.dataContexts.rowsDataContext.rowCount(),
            headerRowHeight = this._runtime.theme.value('table.headerRowHeight'),
            width = 0,
            cellHBorder = this._runtime.theme.value('table.cellHBorder'),
            height = rowCount == 0 ? 0 : rowCount * rowHeight + (rowCount - 1) * cellHBorder.width;

        for (var i = 0; i < visibleColumnIds.length; i++) {
            width += this._getColumnWidthById(visibleColumnIds[i]);
        }

        return {
            header: {
                width: width,
                height: headerRowHeight,
            },
            content: {
                width: width,
                height: height,
            }
        };
    }

    private _getCellStylesheet() {
        var cssText = new Microsoft.Office.Controls.Fundamental.CssTextBuilder(),
            cellPadding = this._runtime.theme.value('table.cellPadding'),
            headerCellPadding = this._runtime.theme.value('table.headerCellPadding'),
            headerCellVBorder = this._runtime.theme.value('table.headerCellVBorder'),
            headerBottomBorder = this._runtime.theme.value('table.headerBottomBorder'),
            cellVBorder = this._runtime.theme.value('table.cellVBorder'),
            cellHBorder = this._runtime.theme.value('table.cellHBorder'),
            oddRowBackgroundColor = this._runtime.theme.value('table.oddRowBackgroundColor'),
            evenRowBackgroundColor = this._runtime.theme.value('table.evenRowBackgroundColor'),
            cellColor = this._runtime.theme.value('table.cellColor'),
            headerRowBackgroundColor = this._runtime.theme.value('table.headerRowBackgroundColor'),
            headerCellColor = this._runtime.theme.value('table.headerCellColor'),
            headerRowHeight = this._runtime.theme.value('table.headerRowHeight'),
            rowHeight = this._runtime.theme.value('table.rowHeight'),
            visibleColumnIds = this._runtime.dataContexts.columnsDataContext.visibleColumnIds(),
            front = 0;

        this._runtime.buildCssRootSelector(cssText);
        cssText.push('.msoc-list-table-header-cell');
        cssText.property('cursor', this._runtime.theme.value('table.headerCursor'));
        cssText.property('font-family', this._runtime.theme.value('table.headerCellFontFamily'));
        cssText.property('font-size', this._runtime.theme.value('table.headerCellFontSize'));
        cssText.property('background-color', headerRowBackgroundColor);
        cssText.property('color', headerCellColor);
        cssText.property('height', headerRowHeight, 'px');

        this._runtime.buildCssRootSelector(cssText);
        cssText.push('.msoc-list-table-header-cell-content');
        cssText.property('top', 0, 'px');
        cssText.property(this._runtime.direction.front(), 0, 'px');
        cssText.property(this._runtime.direction.end(), 0, 'px');
        cssText.property('padding', this._runtime.direction.rtl() ? headerCellPadding.raw.rtl : headerCellPadding.raw.ltr);
        cssText.property('height', headerRowHeight, 'px');
        cssText.property('line-height', headerRowHeight, 'px');

        this._runtime.buildCssRootSelector(cssText);
        cssText.push('.msoc-list-row');
        cssText.property('height', rowHeight, 'px');
        cssText.property('line-height', rowHeight, 'px');
        cssText.property('width', '100', '%');

        this._runtime.buildCssRootSelector(cssText);
        cssText.append('.msoc-list-table-row-border');
        cssText.property('height', cellHBorder.width, 'px');
        cssText.property('width', '100', '%');
        cssText.property('border-bottom', cellHBorder.raw);
        cssText.property('top', rowHeight, 'px');

        this._runtime.buildCssRootSelector(cssText);
        cssText.push('.msoc-list-table-cell');
        cssText.property('cursor', this._runtime.theme.value('table.cellCursor'));
        cssText.property('font-family', this._runtime.theme.value('table.cellFontFamily'));
        cssText.property('font-size', this._runtime.theme.value('table.cellFontSize'));
        cssText.property('color', cellColor);
        cssText.property('height', rowHeight, 'px');

        this._runtime.buildCssRootSelector(cssText);
        cssText.push('.msoc-list-row.msoc-list-odd');
        cssText.property('background-color', oddRowBackgroundColor);

        this._runtime.buildCssRootSelector(cssText);
        cssText.push('.msoc-list-row.msoc-list-even');
        cssText.property('background-color', evenRowBackgroundColor);

        this._runtime.buildCssRootSelector(cssText);
        cssText.push('.msoc-list-table-header-bottom-border');
        cssText.property('height', headerBottomBorder.width, 'px');
        cssText.property('border-bottom', headerBottomBorder.raw);

        this._runtime.buildCssRootSelector(cssText);
        cssText.push('.msoc-list-table-header-cell-splitter-front');
        cssText.property(this._runtime.direction.front(), 0, 'px');
        cssText.property('width', 2, 'px');

        this._runtime.buildCssRootSelector(cssText);
        cssText.push('.msoc-list-table-header-cell-first > .msoc-list-table-header-cell-splitter-front');
        cssText.property('display', 'none');

        this._runtime.buildCssRootSelector(cssText);
        cssText.push('.msoc-list-table-header-cell-splitter-end');
        cssText.property(this._runtime.direction.end(), -cellVBorder.width, 'px');
        cssText.property('width', cellVBorder.width + 2, 'px');

        this._runtime.buildCssRootSelector(cssText);
        cssText.push('.msoc-list-table-cell-content');
        cssText.property('top', 0, 'px');
        cssText.property(this._runtime.direction.front(), 0, 'px');
        cssText.property(this._runtime.direction.end(), 0, 'px');
        cssText.property('padding', this._runtime.direction.rtl() ? cellPadding.raw.rtl : cellPadding.raw.ltr);
        cssText.property('height', rowHeight, 'px');
        cssText.property('line-height', rowHeight, 'px');

        $.each(visibleColumnIds, (index, columnId) => {
            var column = this._runtime.dataContexts.columnsDataContext.getColumnById(columnId),
                width = this._getColumnWidthById(columnId);

            this._runtime.buildCssRootSelector(cssText);
            cssText.push('.msoc-list-table-header-cell.msoc-list-table-header-cell-');
            cssText.push(columnId);
            cssText.property(this._runtime.direction.front(), front, 'px');
            cssText.property('width', width, 'px');
            cssText.property('display', 'block');

            if (index != visibleColumnIds.length - 1) {
                this._runtime.buildCssRootSelector(cssText);
                cssText.push('.msoc-list-table-header-cell-v-border-');
                cssText.push(columnId);
                cssText.property(this._runtime.direction.front(), width, 'px');
                cssText.property('width', cellVBorder.width, 'px');
                cssText.property('border-' + this._runtime.direction.end(), headerCellVBorder.raw);
            }

            this._runtime.buildCssRootSelector(cssText);
            cssText.push('.msoc-list-table-cell-');
            cssText.push(columnId);
            cssText.property(this._runtime.direction.front(), front, 'px');
            cssText.property('width', width, 'px');

            front += width;
        });

        return cssText.toString();
    }

    private _getLayoutStylesheet() {
        var cssText = new Microsoft.Office.Controls.Fundamental.CssTextBuilder(),
            headerBottomBorderHeight = this._runtime.theme.value('table.headerBottomBorder').width,
            canvas = this._calculateCanvasRect();

        cssText.push('.');
        cssText.push(this._runtime.rootClass);
        cssText.property('width', this._runtime.width, 'px');
        cssText.property('height', this._runtime.height, 'px');
        cssText.property('background-color', this._runtime.theme.value('backgroundColor'));

        cssText.push('.');
        cssText.push(this._runtime.rootClass);
        cssText.push(' .msoc-list-content-viewport');
        cssText.property('overflow', 'auto');
        cssText.property('position', 'absolute');
        cssText.property('top', canvas.header.height + headerBottomBorderHeight, 'px');
        cssText.property(this._runtime.direction.front(), 0, 'px');
        cssText.property(this._runtime.direction.end(), 0, 'px');
        cssText.property('bottom', 0, 'px');

        cssText.push('.');
        cssText.push(this._runtime.rootClass);
        cssText.push(' .msoc-list-content-viewport .msoc-list-canvas-container');
        cssText.property('overflow', 'hidden');
        cssText.property('position', 'relative');
        cssText.property('width', canvas.content.width, 'px');
        cssText.property('height', canvas.content.height, 'px');

        cssText.push('.');
        cssText.push(this._runtime.rootClass);
        cssText.push(' .msoc-list-header-viewport');
        cssText.property('overflow', 'hidden');
        cssText.property('position', 'absolute');
        cssText.property('width', '100%');
        cssText.property('height', canvas.header.height + headerBottomBorderHeight, 'px');

        cssText.push('.');
        cssText.push(this._runtime.rootClass);
        cssText.push(' .msoc-list-header-viewport .msoc-list-canvas-container');
        cssText.property('overflow', 'hidden');
        cssText.property('position', 'relative');
        cssText.property('width', canvas.header.width, 'px');
        cssText.property('height', canvas.header.height, 'px');

        cssText.push('.');
        cssText.push(this._runtime.rootClass);
        cssText.push(' .msoc-list-header-viewport .msoc-list-canvas-container.msoc-list-canvas-main > .msoc-list-table-header-bottom-border');
        return cssText.toString();
    }

    private _getRenderRangeUpdater() {
        var __getRenderRange = () => {
            var topRowIndex,
                bottomRowIndex,
                columnFront = 0,
                visibleColumnIds = this._runtime.dataContexts.columnsDataContext.visibleColumnIds(),
                frontColumnIndex = 0,
                front = 0,
                rowHeight = this._runtime.theme.value('table.rowHeight'),
                endColumnIndex = visibleColumnIds.length - 1;

            topRowIndex = Math.floor(this._viewportScrollCoordinate.top() / (rowHeight + this._runtime.theme.value('table.cellHBorder').width));
            topRowIndex = Math.max(0, topRowIndex);
            bottomRowIndex = Math.floor((this._viewportScrollCoordinate.top() + this._uiValues.content.viewport.height) / (rowHeight + this._runtime.theme.value('table.cellHBorder').width));
            bottomRowIndex = Math.min(this._runtime.dataContexts.rowsDataContext.rowCount() - 1, bottomRowIndex);
            bottomRowIndex = Math.max(0, bottomRowIndex);

            for (var columnIndex = 0; columnIndex < visibleColumnIds.length; columnIndex++) {
                front += this._getColumnWidthById(visibleColumnIds[columnIndex]);

                if (front <= this._viewportScrollCoordinate.front()) {
                    frontColumnIndex = columnIndex;
                }

                if (front < this._viewportScrollCoordinate.front() + this._uiValues.content.viewport.clientWidth) {
                    endColumnIndex = columnIndex;
                } else {
                    break;
                }
            }

            return new Range(RangeType.Range, topRowIndex, bottomRowIndex, frontColumnIndex, endColumnIndex);
        };

        var eventSender = new Microsoft.Office.Controls.Fundamental.AccumulateTimeoutInvoker(() => {
            if (this._renderRange.isValid()) {
                // this._runtime.events.emit(
                //     'table.beforeRender',
                //     this,
                //     {
                //         renderRange: this._renderRange,
                //     });
            }
        }, 16.67);

        return new Microsoft.Office.Controls.Fundamental.Updater(
            () => {
                var renderRange = __getRenderRange();
                var rowIds = [];

                if (renderRange.isValid()) {
                    for (var rowIndex = renderRange.top(); rowIndex <= renderRange.bottom(); rowIndex++) {
                        var rowId = this._runtime.dataContexts.rowsDataContext.getRowIdByIndex(rowIndex);

                        if (rowId) {
                            rowIds.push(rowId);
                        }
                    }

                    rowIds.sort();
                }

                return {
                    renderRange: renderRange,
                    rowIds: rowIds,
                }
            },
            (newValue) => {
                var renderRange = newValue.renderRange;

                this._renderRange = renderRange;

                eventSender.invoke();
            });
    }

    private _renderHeaderCellWorker(context) {
        var renderRange = this._renderRange;

        if (!renderRange.isValid()) {
            return;
        }

        var headerMainCanvas = $(this._elements.header.mainCanvas),
            html = new Microsoft.Office.Controls.Fundamental.StringBuilder(),
            addedColumnIds = [],
            visibleColumnIds = this._runtime.dataContexts.columnsDataContext.visibleColumnIds(),
            front = renderRange.front(),
            end = renderRange.end();

        for (var columnIndex = front; columnIndex <= end; columnIndex++) {
            var columnId = visibleColumnIds[columnIndex],
                column = this._runtime.dataContexts.columnsDataContext.getColumnById(columnId);

            if (!context.headerCells[columnId]) {
                context.headerCells[columnId] = {
                    state: RenderState.Initial,
                    contentElement: null,
                };

                html.append('<div class="msoc-list-table-header-cell msoc-list-table-header-cell-');
                html.append(columnId);

                html.append('" data-columnId="');
                html.append(columnId);
                html.append('">');
                html.append('<div class="msoc-list-table-header-cell-content msoc-list-table-header-cell-content-');
                html.append(columnId);
                html.append('">');
                html.append('</div>');
                html.append('<div class="msoc-list-table-header-cell-v-border msoc-list-table-header-cell-v-border-');
                html.append(columnId);
                html.append('"></div>');

                html.append('<div class="msoc-list-table-header-cell-splitter msoc-list-table-header-cell-splitter-front"></div>');
                html.append('<div class="msoc-list-table-header-cell-splitter msoc-list-table-header-cell-splitter-end"></div>');
                html.append('</div>');

                addedColumnIds.push(columnId);
            }
        }

        var headerCellHtml = html.toString();

        if (headerCellHtml.length > 0) {
            headerMainCanvas[0].insertAdjacentHTML('beforeend', headerCellHtml);

            var headerCellContentElements = headerMainCanvas.find('> .msoc-list-table-header-cell > .msoc-list-table-header-cell-content');

            for (var i = 0; i < addedColumnIds.length; i++) {
                var columnId = addedColumnIds[i];

                context.headerCells[columnId].contentElement = headerCellContentElements[headerCellContentElements.length - addedColumnIds.length + i];
            }
        }

        for (var i = <number>renderRange.front(); i<= renderRange.end(); i++) {
            var columnId = visibleColumnIds[i],
                column = this._runtime.dataContexts.columnsDataContext.getColumnById(columnId);

            if (context.headerCells[columnId].state != RenderState.Painted) {
                var render = column.headerRender || SimpleTextHeaderRender.Instance();

                render.render({
                    columnId: columnId,
                    column: column.raw,
                    element: context.headerCells[columnId].contentElement,
                    data: column.raw.data,
                    // height: rect.height,
                    // width: rect.width,
                    rtl: this._runtime.direction.rtl(),
                    theme: this._runtime.theme,
                });

                context.headerCells[columnId].state = RenderState.Painted;
            }
        }
    }

    private _renderCellWorker(context) {
        var html = new Microsoft.Office.Controls.Fundamental.StringBuilder(),
            renderRange = this._renderRange;

        if (!renderRange.isValid()) {
            return;
        }

        for (var rowIndex = renderRange.top(); rowIndex <= renderRange.bottom(); rowIndex++) {
            var row = this._runtime.dataContexts.rowsDataContext.getRowByIndex(rowIndex);

            if (!row) {
                continue;
            }

            var rowId = this._runtime.dataContexts.rowsDataContext.getRowIdByIndex(rowIndex),
                painted = false;

            if (!context.renderedRows[rowId]) {
                context.renderedRows[rowId] = {
                    state: RenderState.Initial,
                    front: NaN,
                    end: NaN,
                    rowElement: null,
                    renderedCells: {},
                };
            }

            if (context.renderedRows[rowId].state == RenderState.Initial) {
                html.append('<div class="msoc-list-row msoc-list-table-row-');
                html.append(rowId);

                if (row.rowIndex % 2 == 1) {
                    html.append(' msoc-list-odd');
                } else {
                    html.append(' msoc-list-even');
                }

                html.append('"');
                html.append(' data-rowId="');
                html.append(rowId);
                html.append('">');

                if (rowIndex != this._runtime.dataContexts.rowsDataContext.rowCount() - 1) {
                    html.append('<div class="msoc-list-table-row-border"></div>');
                }

                html.append('</div>');

                this._elements.content.mainCanvas.insertAdjacentHTML('beforeend', html.toString());
                context.renderedRows[rowId].rowElement = $(this._elements.content.mainCanvas.lastChild);
                context.renderedRows[rowId].state = RenderState.Painted;
                painted = true;
            }

            var rowElement = context.renderedRows[rowId].rowElement;
            var renderedCells = context.renderedRows[rowId].renderedCells;
            var front = renderRange.front();
            var end = renderRange.end();

            html = new Microsoft.Office.Controls.Fundamental.StringBuilder();
            var addedColumnIds = [];

            for (var columnIndex = front; columnIndex <= end; columnIndex++) {
                var columnId = this._runtime.dataContexts.columnsDataContext.getColumnIdByIndex(columnIndex),
                    column = this._runtime.dataContexts.columnsDataContext.getColumnById(columnId);

                if (!renderedCells[columnId]) {
                    renderedCells[columnId] = {
                        state: RenderState.Initial,
                        cellContentElement: null,
                    };

                    html.append('<div class="msoc-list-table-cell msoc-list-table-cell-');
                    html.append(columnId);
                    html.append('"');
                    html.append(' data-rowId="');
                    html.append(rowId);
                    html.append('"');
                    html.append(' data-columnId="');
                    html.append(columnId);
                    html.append('">');
                    html.append('<div class="msoc-list-table-cell-content msoc-list-table-cell-content-');
                    html.append(columnId);
                    html.append('">');
                    html.append('</div>');
                    html.append('</div>');

                    addedColumnIds.push(columnId);
                }
            }

            var cellHtml = html.toString();

            if (cellHtml.length > 0) {
                rowElement[0].insertAdjacentHTML('beforeend', html.toString());

                var cellContentElements = rowElement.find('> .msoc-list-table-cell > div');

                for (var i = 0; i < addedColumnIds.length; i++) {
                    var columnId = addedColumnIds[i];

                    renderedCells[columnId].cellContentElement = cellContentElements[cellContentElements.length - addedColumnIds.length + i];
                }

                painted = true;
            }

            for (var columnIndex = renderRange.front(); columnIndex <= renderRange.end(); columnIndex++) {
                var columnId = this._runtime.dataContexts.columnsDataContext.getColumnIdByIndex(columnIndex),
                    column = this._runtime.dataContexts.columnsDataContext.getColumnById(columnId);

                if (renderedCells[columnId].state != RenderState.Painted) {
                    var render = column.cellRender || SimpleTextCellRender.Instance();

                    render.render({
                        columnId: columnId,
                        column: column.raw,
                        element: renderedCells[columnId].cellContentElement,
                        cellData: row[column.raw.field],
                        // height: rect.height,
                        // width: rect.width,
                        rtl: this._runtime.direction.rtl(),
                        theme: this._runtime.theme,
                    });

                    renderedCells[columnId].state = RenderState.Painted;
                    painted = true;
                }
            }

            if (painted) {
                return true;
            }
        }
    }
}
