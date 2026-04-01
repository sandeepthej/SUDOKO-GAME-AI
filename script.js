document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements Reference
    const boardElement = document.getElementById('sudoku-board');
    const boardInnerWrapper = document.getElementById('board-inner-wrapper');
    const pathSvg = document.getElementById('path-svg');
    const searchPath = document.getElementById('search-path');
    const aiHud = document.getElementById('ai-hud');
    const hudNum = document.querySelector('.hud-num');
    const hudStatus = document.querySelector('.hud-status');
    const btnSolve = document.getElementById('btn-solve');
    const btnClear = document.getElementById('btn-clear');
    const presetBtns = document.querySelectorAll('.preset-btn');
    const toggleVisualize = document.getElementById('toggle-visualize');
    const speedSlider = document.getElementById('speed-slider');
    const nodesCountEl = document.getElementById('nodes-count');
    const depthCountEl = document.getElementById('depth-count');
    
    // SFX
    const successSound = document.getElementById('success-sound');
    const errorSound = document.getElementById('error-sound');
    
    // Core state
    let cells = [];
    let isSolving = false;
    let stopVisualization = false;
    let nodesExplored = 0;
    
    // Interactive visualizer array for SVG laser lines
    let callStack = []; 

    const puzzles = {
        easy: "070000043040009610800634900094052000358460020000800530080070091902100005007040800",
        medium: "020608000580009700000040000370000500600000004008000013000020000009800036000306090",
        hard: "000600400700003600000091080000000000050180003000306045040200060903000000020000100"
    };

    const playSound = (audio) => {
        try { audio.currentTime = 0; audio.play().catch(e => e); } catch(e) {}
    }

    function initBoard() {
        boardElement.innerHTML = '';
        cells = [];
        for (let i = 0; i < 81; i++) {
            const wrapper = document.createElement('div');
            wrapper.className = 'cell';
            const input = document.createElement('input');
            input.type = 'text'; input.maxLength = 1; input.dataset.index = i;
            
            input.addEventListener('input', (e) => {
                if(isSolving) { e.preventDefault(); return; }
                if(!/^[1-9]$/.test(e.target.value)) e.target.value = '';
            });

            wrapper.appendChild(input);
            boardElement.appendChild(wrapper);
            cells.push({ wrapper, input, index: i });
        }
    }

    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if(isSolving) return;
            presetBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setBoard(puzzles[btn.dataset.preset]);
        });
    });

    function setBoard(str) {
        clearBoardState();
        for (let i = 0; i < 81; i++) {
            if (str[i] !== '0') {
                cells[i].input.value = str[i];
                cells[i].input.readOnly = true;
            } else {
                cells[i].input.value = '';
                cells[i].input.readOnly = false;
            }
        }
    }

    function clearBoardState() {
        stopVisualization = true;
        isSolving = false;
        callStack = [];
        nodesExplored = 0;
        updateMetrics();
        drawPath();
        hideHUD();
        
        btnSolve.textContent = "INITIALIZE AI";
        btnSolve.classList.remove("btn-secondary");
        btnSolve.classList.add("btn-primary");
        boardInnerWrapper.classList.remove('board-solved');
        
        cells.forEach(c => {
            c.wrapper.className = 'cell';
            c.input.value = '';
            c.input.readOnly = false;
        });
    }

    btnClear.addEventListener('click', () => {
        const activePreset = document.querySelector('.preset-btn.active').dataset.preset;
        setBoard(puzzles[activePreset]);
    });

    function getBoardMatrix() {
        const board = [];
        for (let i = 0; i < 9; i++) {
            board[i] = [];
            for (let j = 0; j < 9; j++) {
                const val = cells[i * 9 + j].input.value;
                board[i][j] = val ? parseInt(val) : 0;
            }
        }
        return board;
    }

    function detectCollision(board, row, col, num) {
        for (let x = 0; x < 9; x++) {
            if (board[row][x] === num) return `Row Collision at C${x+1}`;
            if (board[x][col] === num) return `Col Collision at R${x+1}`;
        }
        const startR = Math.floor(row / 3) * 3;
        const startC = Math.floor(col / 3) * 3;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                if (board[startR + i][startC + j] === num) return `3x3 Grid Collision`;
            }
        }
        return null;
    }

    // Mathematical SVG path drawing mapped safely to the parent CSS Box
    function drawPath() {
        if(!toggleVisualize.checked) { searchPath.setAttribute('points', ''); return; }
        
        const outerRect = boardInnerWrapper.getBoundingClientRect();
        
        const pointsArray = callStack.map(index => {
            const wrapper = cells[index].wrapper;
            const rect = wrapper.getBoundingClientRect();
            // X / Y strictly relative to the .board-inner-wrapper parent div!
            const x = rect.left - outerRect.left + rect.width / 2;
            const y = rect.top - outerRect.top + rect.height / 2;
            return `${x},${y}`;
        });
        
        searchPath.setAttribute('points', pointsArray.join(" "));
        depthCountEl.textContent = `${callStack.length} / 81`;
    }

    // Dynamic HUD directly overlaying element using parent context metrics
    function showHUD(index, testingNumber, statusMessage, typeClass) {
        if(!toggleVisualize.checked) { hideHUD(); return; }
        
        const outerRect = boardInnerWrapper.getBoundingClientRect();
        const wrapper = cells[index].wrapper;
        const rect = wrapper.getBoundingClientRect();
        
        // Exact horizontal center, top edge
        const x = rect.left - outerRect.left + rect.width / 2;
        const y = rect.top - outerRect.top; 
        
        aiHud.style.left = `${x}px`;
        aiHud.style.top = `${y}px`;
        aiHud.classList.remove('hidden');
        
        hudNum.textContent = `[${testingNumber}]`;
        hudStatus.textContent = statusMessage;
        
        hudStatus.className = 'hud-status';
        if(typeClass) hudStatus.classList.add(typeClass);
    }
    
    function hideHUD() {
        aiHud.classList.add('hidden');
    }

    function updateMetrics() {
        nodesCountEl.textContent = nodesExplored.toLocaleString(); 
    }

    // Intelligent animation pacing yielding function
    async function pauseYield(forceUIUpdate = false) {
        let sliderVal = parseInt(speedSlider.value);
        let delayMs = (100 - sliderVal); 
        
        if (delayMs === 0 && !forceUIUpdate) return; 
        if (delayMs === 0 && forceUIUpdate) delayMs = 1; // absolute minimum yield
        
        await new Promise(r => setTimeout(r, delayMs));
    }

    btnSolve.addEventListener('click', async () => {
        if(isSolving) {
            stopVisualization = true;
            isSolving = false;
            btnSolve.textContent = "INITIALIZE AI";
            btnSolve.className = "btn btn-primary";
            hideHUD();
            return;
        }

        const board = getBoardMatrix();
        let initialEmpty = 0;
        for(let r=0; r<9; r++) for(let c=0; c<9; c++) if(board[r][c] === 0) initialEmpty++;
        if (initialEmpty === 0) return;

        isSolving = true;
        stopVisualization = false;
        nodesExplored = 0;
        callStack = [];
        
        btnSolve.textContent = "HALT SYSTEM";
        btnSolve.className = "btn btn-secondary";
        boardInnerWrapper.classList.remove('board-solved');

        // Render lock inputs
        cells.forEach(c => { if(c.input.value) c.input.readOnly = true; });

        if(toggleVisualize.checked) {
            const solved = await solveBacktrackingVisual(board);
            if(solved && !stopVisualization) finalSuccessUI();
        } else {
            solveBacktrackingInstant(board);
            if(!stopVisualization) {
                // Instantly inject arrays to UI layer
                board.forEach((row, i) => row.forEach((val, j) => {
                    cells[i*9+j].input.value = val;
                }));
                finalSuccessUI();
            }
        }
    });
    
    function finalSuccessUI() {
        hideHUD();
        searchPath.setAttribute('points', ''); // Clear path
        boardInnerWrapper.classList.add('board-solved');
        isSolving = false;
        btnSolve.textContent = "INITIALIZE AI";
        btnSolve.className = "btn btn-primary";
        playSound(successSound);
        updateMetrics();
    }

    function solveBacktrackingInstant(board) {
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (board[r][c] === 0) {
                    for (let n = 1; n <= 9; n++) {
                        nodesExplored++;
                        if (!detectCollision(board, r, c, n)) {
                            board[r][c] = n;
                            if (solveBacktrackingInstant(board)) return true;
                            board[r][c] = 0;
                        }
                    }
                    return false;
                }
            }
        }
        return true;
    }

    async function solveBacktrackingVisual(board) {
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                // Find empty cell
                if (board[r][c] === 0) {
                    
                    const cellIndex = r * 9 + c;
                    const cellEl = cells[cellIndex];
                    
                    // --- DFS PATH APPEND ---
                    callStack.push(cellIndex); 
                    drawPath();
                    cellEl.wrapper.classList.add('active');

                    // Standard algorithm tests digits 1-9 sequentially
                    for (let testN = 1; testN <= 9; testN++) {
                        if(stopVisualization) return false;
                        
                        nodesExplored++;
                        if(nodesExplored % 3 === 0) updateMetrics();

                        const collisionReason = detectCollision(board, r, c, testN);
                        
                        // We immediately evaluate collision
                        if (!collisionReason) {
                            
                            // SUCCESS: Guess is valid under current constraints. Pushing deep.
                            board[r][c] = testN;
                            cellEl.input.value = testN;
                            cellEl.wrapper.classList.add('success-pulse');
                            showHUD(cellIndex, testN, "Constraint Valid", "success");
                            
                            // Force brief pause to let user see successful guess!
                            await pauseYield(true);
                            
                            cellEl.wrapper.classList.remove('success-pulse');

                            // Recursive Call
                            if (await solveBacktrackingVisual(board)) return true;
                            
                            // ============================================
                            // BACKTRACK MECHANISM
                            // ============================================
                            board[r][c] = 0;
                            cellEl.input.value = testN; 
                            cellEl.wrapper.classList.add('backtrack-pulse');
                            showHUD(cellIndex, testN, "Dead End Downstream - Backtracking", "backtrack");
                            playSound(errorSound);
                            
                            await pauseYield(true); // Mandatory yield to show backfire graphics
                            cellEl.wrapper.classList.remove('backtrack-pulse');
                            
                        } else {
                            // FAILURE: Baseline collision detected immediately. Skip tree depth.
                            cellEl.input.value = testN;
                            cellEl.wrapper.classList.add('error-pulse');
                            showHUD(cellIndex, testN, collisionReason, "error");
                            
                            // If speed slider is HIGH, pauseYield won't pause here. So the AI rips past errors
                            // intelligently, without leaving misleading inputs permanently on screen.
                            await pauseYield(false); 
                            
                            cellEl.wrapper.classList.remove('error-pulse');
                        }
                    }
                    
                    // Total search depth exhaustion. Returning to ancestor node.
                    cellEl.input.value = '';
                    cellEl.wrapper.classList.remove('active');
                    
                    callStack.pop(); 
                    drawPath(); 
                    return false;
                }
            }
        }
        updateMetrics();
        return true;
    }

    initBoard();
    setBoard(puzzles.medium);
});
