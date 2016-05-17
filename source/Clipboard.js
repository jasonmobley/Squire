/*jshint strict:false, undef:false, unused:false */

var onCut = function ( event ) {
    var clipboardData = event.clipboardData;
    var range = this.getSelection();
    var node = this.createElement( 'div' );
    var root = this._root;
    var self = this;

    // Save undo checkpoint
    this.saveUndoState( range );

    // Edge only seems to support setting plain text as of 2016-03-11.
    // Mobile Safari flat out doesn't work:
    // https://bugs.webkit.org/show_bug.cgi?id=143776
    if ( !isEdge && !isIOS && clipboardData ) {
        moveRangeBoundariesUpTree( range, root );
        node.appendChild( deleteContentsOfRange( range, root ) );
        clipboardData.setData( 'text/html', node.innerHTML );
        clipboardData.setData( 'text/plain',
            node.innerText || node.textContent );
        event.preventDefault();
    } else {
        setTimeout( function () {
            try {
                // If all content removed, ensure div at start of root.
                self._ensureBottomLine();
            } catch ( error ) {
                self.didError( error );
            }
        }, 0 );
    }

    this.setSelection( range );
};

var onCopy = function ( event ) {
    var clipboardData = event.clipboardData;
    var range = this.getSelection();
    var node = this.createElement( 'div' );

    // Edge only seems to support setting plain text as of 2016-03-11.
    // Mobile Safari flat out doesn't work:
    // https://bugs.webkit.org/show_bug.cgi?id=143776
    if ( !isEdge && !isIOS && clipboardData ) {
        node.appendChild( range.cloneContents() );
        clipboardData.setData( 'text/html', node.innerHTML );
        clipboardData.setData( 'text/plain',
            node.innerText || node.textContent );
        event.preventDefault();
    }
};

var onPaste = function ( event ) {
    var clipboardData = event.clipboardData,
        items = clipboardData && clipboardData.items,
        hasImage = false,
        plainItem = null,
        self = this,
        l, item, type, types, data;

        types = clipboardData && clipboardData.types;

        // If we have files, use the  HTML5 Clipboard interface.
        var hasFiles = ( types && ( indexOf.call( types, 'Files' ) >= 0 ));

        // if pasted content has html data, then use code as there is no clipboard interface
        var hasHtml = ( types && ( indexOf.call( types, 'text/html' ) >= 0 ));

    // Current HTML5 Clipboard interface
    // ---------------------------------
    // https://html.spec.whatwg.org/multipage/interaction.html

    // Edge only provides access to plain text as of 2016-03-11.

    // Chrome 50: getAsString returns for 'text/html' returns extra charecter for content copied from MS Word
    // and Outlook. So we skip using the item.getAsString if the clipboard content has html content.
    // This has been fixed in Chrome/Canary 52.

    // TODO: remove "hasHtml" from the if statement when Chrome versions under 52 are not supported
    // Chrome 52 : getAsString returns an empty string If we have an RTF content, so get the plain text instead
    // https://bugs.chromium.org/p/chromium/issues/detail?id=317807
    if ( items && ( hasFiles || ( !isEdge && !hasHtml ))) {
        event.preventDefault();
        l = items.length;
        while ( l-- ) {
            item = items[l];
            type = item.type;
            if ( type === 'text/html' ) {
                /*jshint loopfunc: true */
                item.getAsString( function ( html ) {
                    self.insertHTML( html, true );
                });
                /*jshint loopfunc: false */
                return;
            }
            if ( type === 'text/plain' ) {
                plainItem = item;
            }
            if ( /^image\/.*/.test( type ) ) {
                hasImage = true;
            }
        }
        // Trigger a willPaste event if these is an image type on the clipboardData.
        if ( hasImage ) {
            var imagePasteEvent = {
                clipboardData: event.clipboardData,
                isImage: true,
                preventDefault: function () {
                    this.defaultPrevented = true;
                },
                defaultPrevented: false
            };

            this.fireEvent( 'willPaste', imagePasteEvent);

        } else if ( plainItem ) {
            item.getAsString( function ( text ) {
                self.insertPlainText( text, true );
            });
        }
        return;
    }

    // Old interface
    // -------------

    // Safari (and indeed many other OS X apps) copies stuff as text/rtf
    // rather than text/html; even from a webpage in Safari. The only way
    // to get an HTML version is to fallback to letting the browser insert
    // the content. Same for getting image data. *Sigh*.
    //
    // Firefox is even worse: it doesn't even let you know that there might be
    // an RTF version on the clipboard, but it will also convert to HTML if you
    // let the browser insert the content. I've filed
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1254028

    // TODO: remove "items" from the if statement when Chrome versions under 52 are not supported
    // Chrome clipboardData.getData returns extra characters, so skip this if "items" is truthy. "items"
    if (!items && !isEdge && types && (
            indexOf.call( types, 'text/html' ) > -1 || (
                !isGecko &&
                indexOf.call( types, 'text/plain' ) > -1 &&
                indexOf.call( types, 'text/rtf' ) < 0 )
            )) {
        event.preventDefault();
        // Abiword on Linux copies a plain text and html version, but the HTML
        // version is the empty string! So always try to get HTML, but if none,
        // insert plain text instead. On iOS, Facebook (and possibly other
        // apps?) copy links as type text/uri-list, but also insert a **blank**
        // text/plain item onto the clipboard. Why? Who knows.
        if (( data = clipboardData.getData( 'text/html' ) )) {
            this.insertHTML( data, true );
        } else if (
                ( data = clipboardData.getData( 'text/plain' ) ) ||
                ( data = clipboardData.getData( 'text/uri-list' ) ) ) {
            this.insertPlainText( data, true );
        }
        return;
    }

    // No interface. Includes all versions of IE :(
    // --------------------------------------------

    this._awaitingPaste = true;

    var body = this._doc.body,
        range = this.getSelection(),
        startContainer = range.startContainer,
        startOffset = range.startOffset,
        endContainer = range.endContainer,
        endOffset = range.endOffset;

    // We need to position the pasteArea in the visible portion of the screen
    // to stop the browser auto-scrolling.
    var pasteArea = this.createElement( 'DIV', {
        contenteditable: 'true',
        style: 'position:fixed; overflow:hidden; top:0; right:100%; width:1px; height:1px;'
    });
    body.appendChild( pasteArea );
    range.selectNodeContents( pasteArea );
    this.setSelection( range );

    // A setTimeout of 0 means this is added to the back of the
    // single javascript thread, so it will be executed after the
    // paste event.
    setTimeout( function () {
        try {
            // IE sometimes fires the beforepaste event twice; make sure it is
            // not run again before our after paste function is called.
            self._awaitingPaste = false;

            // Get the pasted content and clean
            var html = '',
                next = pasteArea,
                first, range;

            // #88: Chrome can apparently split the paste area if certain
            // content is inserted; gather them all up.
            while ( pasteArea = next ) {
                next = pasteArea.nextSibling;
                detach( pasteArea );
                // Safari and IE like putting extra divs around things.
                first = pasteArea.firstChild;
                if ( first && first === pasteArea.lastChild &&
                        first.nodeName === 'DIV' ) {
                    pasteArea = first;
                }
                html += pasteArea.innerHTML;
            }

            range = self._createRange(
                startContainer, startOffset, endContainer, endOffset );
            self.setSelection( range );

            if ( html ) {
                self.insertHTML( html, true );
            }
        } catch ( error ) {
            self.didError( error );
        }
    }, 0 );
};

    this._isDragging = true;
};

    this._isDragging = false;
};

var onDrop = function( event ) {
    var dataTransfer = event.dataTransfer;

    var hasFiles = ( dataTransfer && dataTransfer.files && dataTransfer.files.length );

    if( !hasFiles ) {
        var self = this;

        // If we are dragging and dropping within the editor, we will save the
        // undo state and allow default browser behavior.
        if( this._isDragging ) {
            this._isDragging = false;
            var selectedRange = this.getSelection();
            this.saveUndoState();
            this.setSelection( selectedRange );

            return;
        }

        var insertHtmlItem = function ( html ) {
            self.insertHTML( html, true );
        };

        if( dataTransfer.items ) {
            for( var i = 0; i < dataTransfer.items.length; i++ ) {
                var item = dataTransfer.items[i];
                if( item.type === 'text/html') {
                    event.preventDefault();

                    item.getAsString( insertHtmlItem );

                    return;
                }
            }
        }

        // Some browsers will not put the html on the drop event. So we will wait
        // until after the drop to clean it.
        var range = this.getSelection();
        this.saveUndoState();
        this.setSelection( range );
        setTimeout( function () {
            try {
                cleanTree( self._root );
                addLinks( range.startContainer, self._root, self );

            } catch ( error ) {
                self.didError( error );
            }
        }, 0 );
    }
};
