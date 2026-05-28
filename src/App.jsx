import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { Trophy, Users, ShieldAlert, LogOut, ArrowRight, RotateCcw, Play, X } from 'lucide-react';

// ==========================================
// 1. Firebase Initialization (Strict Requirements)
// ==========================================
let app, auth, db, appId, docRef;

try {
    // 캔버스 환경 및 로컬 환경변수(.env) 모두 지원
    const configStr = typeof __firebase_config !== 'undefined' ? __firebase_config : null;
    const firebaseConfig = configStr ? JSON.parse(configStr) : {
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID
    };
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    
    const globalAppId = typeof __app_id !== 'undefined' ? __app_id : null;
    appId = globalAppId || import.meta.env.VITE_APP_ID || 'jfl-draft-app';
    
    // Rule 1: Strict Paths for public shared data
    docRef = doc(db, 'artifacts', appId, 'public', 'data', 'jfl_state', 'main_game');
} catch (e) {
    console.error("Firebase init error:", e);
}

// ==========================================
// 2. Constants & Data Models
// ==========================================
const TEAMS = ['A', 'B', 'C', 'D', 'E', 'F'];
const TEAM_COLORS = {
    'A': 'bg-blue-600',
    'B': 'bg-red-600',
    'C': 'bg-yellow-500',
    'D': 'bg-gray-500',
    'E': 'bg-purple-600',
    'F': 'bg-green-600'
};

const ROUNDS = [
    { id: 1, name: "1라운드 - 투수", prefix: "P" },
    { id: 2, name: "2라운드 - 포수", prefix: "C" },
    { id: 3, name: "3라운드 - 내야수", prefix: "I" },
    { id: 4, name: "4라운드 - 외야수", prefix: "O" }
];

const generatePlayers = (prefix) => {
    return Array.from({ length: 8 }, (_, i) => `${prefix}${(i + 1).toString().padStart(2, '0')}`);
};

const INITIAL_GAME_STATE = {
    round: 1,
    phase: 'bidding', // 'bidding' | 'result' | 'finished'
    budgets: { A: 200, B: 200, C: 200, D: 200, E: 200, F: 200 },
    bids: { 1: {}, 2: {}, 3: {}, 4: {} },
    results: { 1: {}, 2: {}, 3: {}, 4: {} }
};

// ==========================================
// 3. Main Application Component
// ==========================================
export default function App() {
    const [user, setUser] = useState(null);
    const [gameState, setGameState] = useState(null);
    const [localTeam, setLocalTeam] = useState(null); // 'A'-'F', 'teacher', null
    const [view, setView] = useState('home'); // 'home', 'bidding', 'teacher'
    const [errorMsg, setErrorMsg] = useState('');

    // UI States for replacing prompt/confirm
    const [showTeacherLogin, setShowTeacherLogin] = useState(false);
    const [teacherPwInput, setTeacherPwInput] = useState('');
    const [loginError, setLoginError] = useState('');
    const [confirmDialog, setConfirmDialog] = useState(null); // { message, onConfirm }

    // Firebase Auth (Rule 3)
    useEffect(() => {
        if (!auth) return;
        const initAuth = async () => {
            try {
                if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                    await signInWithCustomToken(auth, __initial_auth_token);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (err) {
                console.error("Auth Error:", err);
                setErrorMsg("인증에 실패했습니다. 새로고침 해주세요.");
            }
        };
        initAuth();
        const unsubscribe = onAuthStateChanged(auth, setUser);
        return () => unsubscribe();
    }, []);

    // Firebase Data Sync
    useEffect(() => {
        if (!user || !docRef) return;

        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setGameState(data);

                // Auto-navigate based on state changes if acting as a team
                if (localTeam && localTeam !== 'teacher') {
                    if (data.phase === 'result' || data.phase === 'finished') {
                        setView('result');
                    } else if (data.phase === 'bidding') {
                        setView('bidding');
                    }
                }
            } else {
                // Initialize if empty
                setDoc(docRef, INITIAL_GAME_STATE);
            }
        }, (err) => {
            console.error("Sync Error:", err);
            setErrorMsg("데이터 동기화 실패. 네트워크를 확인하세요.");
        });

        return () => unsubscribe();
    }, [user, localTeam]);

    // ==========================================
    // Core Logic Functions
    // ==========================================
    const handleSubmitBid = async (pick1, token1, pick2, token2) => {
        if (!gameState || !localTeam) return;

        const currentRound = gameState.round;
        const newBids = { ...gameState.bids };

        newBids[currentRound] = {
            ...newBids[currentRound],
            [localTeam]: { pick1, token1: parseInt(token1, 10), pick2, token2: parseInt(token2, 10) }
        };

        try {
            await updateDoc(docRef, { bids: newBids });
            // UI will automatically show waiting screen via render logic
        } catch (err) {
            setErrorMsg("입찰 저장에 실패했습니다. 다시 시도해주세요.");
        }
    };

    // 1순위 -> 2순위 -> 마이너리그 순차적 배정 로직 (핵심 엔진)
    const resolveRound = async (force = false) => {
        if (!gameState) return;
        const roundInfo = ROUNDS.find(r => r.id === gameState.round);
        const currentBids = gameState.bids[gameState.round] || {};

        if (!force && Object.keys(currentBids).length < 6) {
            return; // 아직 모두 제출하지 않음
        }

        let results = {};
        let newBudgets = { ...gameState.budgets };
        let unassignedTeams = [...TEAMS];
        let takenPlayers = new Set();

        // 1단계: 1순위 경합 처리
        let firstPicks = {};
        unassignedTeams.forEach(team => {
            if (currentBids[team]) {
                const { pick1, token1 } = currentBids[team];
                if (!firstPicks[pick1]) firstPicks[pick1] = [];
                firstPicks[pick1].push({ team, token1 });
            }
        });

        for (const [player, requests] of Object.entries(firstPicks)) {
            const maxToken = Math.max(...requests.map(r => r.token1));
            const topBidders = requests.filter(r => r.token1 === maxToken);
            const winner = topBidders[Math.floor(Math.random() * topBidders.length)]; // 동점 시 랜덤

            results[winner.team] = {
                player,
                cost: winner.token1,
                method: topBidders.length > 1 ? '동점추첨' : '정상'
            };
            newBudgets[winner.team] -= winner.token1;
            takenPlayers.add(player);
            unassignedTeams = unassignedTeams.filter(t => t !== winner.team);
        }

        // 2단계: 1순위 실패 모둠들의 2순위 경합 처리
        let secondPicks = {};
        unassignedTeams.forEach(team => {
            if (currentBids[team]) {
                const { pick2, token2 } = currentBids[team];
                if (!takenPlayers.has(pick2)) { // 아직 안 뽑힌 선수만
                    if (!secondPicks[pick2]) secondPicks[pick2] = [];
                    secondPicks[pick2].push({ team, token2 });
                }
            }
        });

        for (const [player, requests] of Object.entries(secondPicks)) {
            const maxToken = Math.max(...requests.map(r => r.token2));
            const topBidders = requests.filter(r => r.token2 === maxToken);
            const winner = topBidders[Math.floor(Math.random() * topBidders.length)];

            results[winner.team] = {
                player,
                cost: winner.token2,
                method: topBidders.length > 1 ? '동점추첨(2순위)' : '정상(2순위)'
            };
            newBudgets[winner.team] -= winner.token2;
            takenPlayers.add(player);
            unassignedTeams = unassignedTeams.filter(t => t !== winner.team);
        }

        // 3단계: 1,2순위 모두 실패/입찰 안 한 모둠 미낙찰 처리
        unassignedTeams.forEach(team => {
            results[team] = { player: '-', cost: 0, method: '미낙찰' };
        });

        // 상태 업데이트
        const newResults = { ...gameState.results, [gameState.round]: results };
        const nextPhase = gameState.round >= 4 ? 'finished' : 'result';

        await updateDoc(docRef, {
            budgets: newBudgets,
            results: newResults,
            phase: nextPhase
        });
    };

    // 모둠이 모두 제출했는지 감시하여 자동 결과 처리
    useEffect(() => {
        if (gameState && gameState.phase === 'bidding') {
            const currentBidsCount = Object.keys(gameState.bids[gameState.round] || {}).length;
            if (currentBidsCount >= 6) {
                resolveRound(false);
            }
        }
    }, [gameState]);

    const handleNextRound = async () => {
        if (!gameState || gameState.round >= 4) return;
        await updateDoc(docRef, {
            round: gameState.round + 1,
            phase: 'bidding'
        });
    };

    const handleResetGame = () => {
        setConfirmDialog({
            message: "정말 전체 게임을 초기화하시겠습니까?\n모든 데이터가 삭제되고 1라운드부터 다시 시작합니다.",
            onConfirm: async () => {
                await setDoc(docRef, INITIAL_GAME_STATE);
                setConfirmDialog(null);
            }
        });
    };

    const handleTeacherLogin = (e) => {
        e.preventDefault();
        if (teacherPwInput === "jfl2025") {
            setLocalTeam('teacher');
            setView('teacher');
            setShowTeacherLogin(false);
            setTeacherPwInput('');
            setLoginError('');
        } else {
            setLoginError('비밀번호가 일치하지 않습니다.');
        }
    };

    // ==========================================
    // Render Helpers
    // ==========================================
    if (!gameState) {
        return (
            <div className="min-h-screen bg-[#1F4E79] flex items-center justify-center text-white font-sans">
                <div className="animate-spin text-[#ED7D31] mr-3"><RotateCcw size={32} /></div>
                <p className="text-xl">데이터베이스 연결 중...</p>
            </div>
        );
    }

    // ==========================================
    // Views
    // ==========================================
    const renderHome = () => (
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
            <div className="mb-10 text-center">
                <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-4 tracking-wider">JFL DRAFT <span className="text-[#ED7D31]">2026</span></h1>
                <p className="text-blue-200">초등학교 야구 신인 드래프트 입찰 시스템</p>
            </div>

            <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8 w-full max-w-2xl">
                <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center border-b pb-4">우리 구단 선택하기</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {TEAMS.map(team => (
                        <button
                            key={team}
                            onClick={() => { setLocalTeam(team); setView(gameState.phase === 'bidding' ? 'bidding' : 'result'); }}
                            className={`${TEAM_COLORS[team]} hover:opacity-80 text-white font-bold py-5 rounded-xl shadow-md transition-transform transform hover:scale-105 flex flex-col items-center`}
                        >
                            <span className="text-3xl mb-2">{team}</span>
                            <span className="text-sm opacity-90">구단 입장</span>
                        </button>
                    ))}
                </div>

                <div className="mt-10 pt-6 border-t border-gray-200 flex justify-center">
                    <button
                        onClick={() => setShowTeacherLogin(true)}
                        className="text-gray-500 hover:text-gray-800 font-medium flex items-center text-sm transition-colors p-2 rounded hover:bg-gray-100"
                    >
                        <ShieldAlert size={16} className="mr-1" /> 선생님(관리자) 입장
                    </button>
                </div>
            </div>
        </div>
    );

    const renderBidding = () => {
        const currentRoundInfo = ROUNDS.find(r => r.id === gameState.round);
        const players = generatePlayers(currentRoundInfo.prefix);
        const myBudget = gameState.budgets[localTeam];
        const hasSubmitted = !!gameState.bids[gameState.round]?.[localTeam];
        const submittedCount = Object.keys(gameState.bids[gameState.round] || {}).length;

        return (
            <div className="max-w-md mx-auto mt-6">
                {/* Header */}
                <div className="bg-white rounded-t-2xl p-4 shadow-sm flex justify-between items-center border-b-4 border-[#ED7D31]">
                    <div className="flex items-center space-x-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-inner ${TEAM_COLORS[localTeam]}`}>
                            {localTeam}
                        </div>
                        <div>
                            <div className="text-xs text-gray-500 font-bold">현재 내 구단</div>
                            <div className="font-bold text-gray-800">{localTeam} 구단</div>
                        </div>
                    </div>
                    <button onClick={() => { setLocalTeam(null); setView('home'); }} className="p-2 text-gray-400 hover:text-gray-700 bg-gray-100 rounded-full">
                        <LogOut size={18} />
                    </button>
                </div>

                {/* Status Board */}
                <div className="bg-[#1a3f61] p-5 text-white shadow-lg text-center">
                    <h2 className="text-2xl font-black mb-1">{currentRoundInfo.name}</h2>
                    <div className="inline-block bg-[#ED7D31] text-white px-4 py-1 rounded-full text-sm font-bold shadow-sm">
                        보유 예산: {myBudget} 토큰
                    </div>
                </div>

                {/* Form or Waiting */}
                <div className="bg-gray-50 rounded-b-2xl p-6 shadow-md border-t border-gray-200">
                    {hasSubmitted ? (
                        <div className="text-center py-10">
                            <div className="inline-block animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-[#1F4E79] mb-6"></div>
                            <h3 className="text-2xl font-bold text-[#1F4E79] mb-2">대기 중...</h3>
                            <p className="text-gray-600 font-medium">다른 구단의 입찰을 기다리고 있습니다.</p>
                            <div className="mt-6 bg-white p-4 rounded-xl border border-gray-200 shadow-inner">
                                <p className="text-lg font-bold text-[#ED7D31] mb-1">제출 현황</p>
                                <p className="text-3xl font-black text-gray-800">{submittedCount} <span className="text-lg text-gray-500">/ 6 모둠</span></p>
                            </div>
                        </div>
                    ) : (
                        <BiddingForm
                            key={gameState.round} // 라운드 변경 시 폼을 강제로 초기화시켜 화면 전환 문제 해결
                            players={players}
                            budget={myBudget}
                            onSubmit={handleSubmitBid}
                            errorMsg={errorMsg}
                        />
                    )}
                </div>
            </div>
        );
    };

    const renderResult = () => {
        const isFinished = gameState.phase === 'finished';
        const roundToView = isFinished ? 4 : gameState.round;
        const roundInfo = ROUNDS.find(r => r.id === roundToView);
        const results = gameState.results[roundToView] || {};

        // 👑 점수 계산 로직 (최종 결과용)
        const teamScores = TEAMS.map(team => {
            let score = 0;
            ROUNDS.forEach(r => {
                const res = gameState.results[r.id]?.[team];
                if (res) {
                    if (res.method.includes('2순위')) score += 20;
                    else if (res.method !== '미낙찰') score += 25; // 1순위 낙찰 (정상, 동점추첨)
                }
            });
            return { team, score };
        }).sort((a, b) => b.score - a.score);

        return (
            <div className="max-w-4xl mx-auto mt-6 px-2 pb-10">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-3xl font-black text-white drop-shadow-md">
                        {isFinished ? '드래프트 최종 결과' : `${roundInfo.name} 결과 발표`}
                    </h2>
                    {localTeam !== 'teacher' && (
                        <button onClick={() => { setLocalTeam(null); setView('home'); }} className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg backdrop-blur-sm transition">
                            구단 변경
                        </button>
                    )}
                </div>

                {/* 이번 라운드 결과 카드 */}
                <div className="bg-white rounded-2xl shadow-xl overflow-hidden mb-8 border-t-8 border-[#ED7D31]">
                    <div className="bg-gray-100 p-4 border-b">
                        <h3 className="text-xl font-bold text-gray-800">이번 라운드 낙찰 현황</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-50 text-gray-600 text-sm">
                                    <th className="p-4 font-bold border-b text-center">구단</th>
                                    <th className="p-4 font-bold border-b">낙찰 선수</th>
                                    <th className="p-4 font-bold border-b text-right">소모 토큰</th>
                                    <th className="p-4 font-bold border-b">낙찰 방식</th>
                                </tr>
                            </thead>
                            <tbody>
                                {TEAMS.map(team => {
                                    const res = results[team];
                                    if (!res) return null;
                                    const isFailed = res.method === '미낙찰';
                                    return (
                                        <tr key={team} className="hover:bg-blue-50 border-b last:border-0 transition-colors">
                                            <td className="p-4 text-center">
                                                <span className={`inline-block w-8 h-8 rounded-full text-white font-bold leading-8 shadow-sm ${TEAM_COLORS[team]}`}>{team}</span>
                                            </td>
                                            <td className="p-4 font-bold text-lg">
                                                <span className="flex items-center gap-2">
                                                    {isFailed ? <span title="미낙찰">❌</span> : <span title="정상 낙찰">🏆</span>}
                                                    <span className={isFailed ? "text-gray-400" : "text-[#1F4E79]"}>{res.player}</span>
                                                </span>
                                            </td>
                                            <td className="p-4 font-black text-right text-[#ED7D31]">
                                                {res.cost} <span className="text-xs text-gray-500">T</span>
                                            </td>
                                            <td className="p-4">
                                                <span className={`px-3 py-1 rounded-full text-xs font-bold ${isFailed ? 'bg-gray-200 text-gray-500' :
                                                        res.method.includes('동점') ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'
                                                    }`}>
                                                    {res.method}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* 전체 구단 현황 */}
                <div className="bg-white rounded-2xl shadow-xl overflow-hidden mb-8">
                    <div className="bg-gray-100 p-4 border-b">
                        <h3 className="text-xl font-bold text-gray-800">전체 구단 누적 현황</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
                        {TEAMS.map(team => (
                            <div key={team} className="border rounded-xl p-4 flex flex-col relative overflow-hidden group hover:border-[#1F4E79] transition-colors">
                                <div className={`absolute top-0 left-0 w-2 h-full ${TEAM_COLORS[team]}`}></div>
                                <div className="flex justify-between items-center mb-3 pl-3">
                                    <span className="font-black text-xl text-gray-800">{team} 구단</span>
                                    <span className="bg-[#1F4E79] text-white px-3 py-1 rounded-full text-sm font-bold shadow-sm">{gameState.budgets[team]} 토큰 남음</span>
                                </div>
                                <div className="pl-3 space-y-1">
                                    {ROUNDS.map(r => {
                                        const p = gameState.results[r.id]?.[team]?.player;
                                        return (
                                            <div key={r.id} className="text-sm flex justify-between items-center border-b border-gray-100 last:border-0 py-1">
                                                <span className="text-gray-500">{r.id}R ({r.prefix})</span>
                                                <span className={`font-bold ${p === '-' ? 'text-red-500' : 'text-gray-800'}`}>{p || '-'}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 최종 라운드 종료 시: 구단별 낙찰 성공률 점수판 */}
                {isFinished && (
                    <div className="bg-white rounded-2xl shadow-xl overflow-hidden mb-8 border-t-8 border-yellow-400">
                        <div className="bg-yellow-50 p-4 border-b border-yellow-100">
                            <h3 className="text-xl font-bold text-yellow-800">🏆 최종 드래프트 낙찰 성공률 점수 🏆</h3>
                            <p className="text-sm text-yellow-600 mt-1">* 1순위 낙찰: 25점 | 2순위 낙찰: 20점 | 미낙찰: 0점 (총점 100점 만점)</p>
                        </div>
                        <div className="p-6">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                                {teamScores.map((ts, idx) => (
                                    <div key={ts.team} className="border border-gray-200 rounded-xl p-4 flex flex-col items-center justify-center relative bg-gray-50 shadow-sm">
                                        {idx === 0 && ts.score > 0 && <div className="absolute -top-4 -right-2 text-4xl" title="1위">👑</div>}
                                        <span className={`w-14 h-14 rounded-full text-white flex items-center justify-center font-black text-2xl mb-3 shadow-md ${TEAM_COLORS[ts.team]}`}>{ts.team}</span>
                                        <span className="text-4xl font-black text-gray-800">{ts.score}<span className="text-xl text-gray-500 font-bold">점</span></span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderTeacher = () => {
        const currentBids = gameState.bids[gameState.round] || {};
        const submittedTeams = Object.keys(currentBids);

        const handleForceInit = (team) => {
            setConfirmDialog({
                message: `${team} 구단의 이번 라운드 입찰을 취소하시겠습니까?`,
                onConfirm: async () => {
                    const newBids = { ...gameState.bids };
                    delete newBids[gameState.round][team];
                    await updateDoc(docRef, { bids: newBids });
                    setConfirmDialog(null);
                }
            });
        };

        return (
            <div className="max-w-5xl mx-auto mt-6">
                <div className="bg-white rounded-2xl shadow-xl overflow-hidden border-t-8 border-gray-800 mb-6">
                    <div className="bg-gray-800 text-white p-6 flex justify-between items-center">
                        <div>
                            <h2 className="text-2xl font-black flex items-center"><ShieldAlert className="mr-2" /> 선생님 컨트롤 패널</h2>
                            <p className="text-gray-400 mt-1">현재 상태: {gameState.phase === 'bidding' ? `${gameState.round}라운드 입찰 진행 중` : `${gameState.round}라운드 결과 공개 됨`}</p>
                        </div>
                        <button onClick={() => { setLocalTeam(null); setView('home'); }} className="text-white hover:text-gray-300">나가기</button>
                    </div>

                    <div className="p-6">
                        {gameState.phase === 'bidding' && (
                            <>
                                <div className="flex justify-between items-end mb-4">
                                    <h3 className="font-bold text-lg">현재 라운드 입찰 현황 ({submittedTeams.length}/6)</h3>
                                    <span className="text-sm text-gray-500">* 학생들의 실제 입찰 내용이 실시간으로 표시됩니다.</span>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
                                    {TEAMS.map(team => {
                                        const isSubmitted = submittedTeams.includes(team);
                                        const bidData = currentBids[team];
                                        const budget = gameState.budgets[team];

                                        return (
                                            <div key={team} className={`p-4 rounded-xl border-2 ${isSubmitted ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-gray-50'} flex flex-col items-center relative transition-all`}>
                                                <span className={`w-8 h-8 rounded-full text-white flex items-center justify-center font-bold mb-1 shadow-sm ${TEAM_COLORS[team]}`}>{team}</span>
                                                <span className="text-xs text-gray-500 mb-2 font-bold">남은 예산: {budget}T</span>

                                                {isSubmitted && bidData ? (
                                                    <div className="w-full bg-white rounded border border-green-200 p-2 text-sm mt-1 shadow-sm">
                                                        <div className="flex justify-between border-b border-gray-100 pb-1 mb-1">
                                                            <span className="text-gray-600">1순위</span>
                                                            <span className="font-bold text-[#1F4E79]">{bidData.pick1} <span className="text-[#ED7D31]">({bidData.token1}T)</span></span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                            <span className="text-gray-600">2순위</span>
                                                            <span className="font-bold text-[#1F4E79]">{bidData.pick2} <span className="text-[#ED7D31]">({bidData.token2}T)</span></span>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className={`font-bold mt-4 mb-4 ${isSubmitted ? 'text-green-700' : 'text-gray-400'}`}>
                                                        미제출
                                                    </span>
                                                )}

                                                {isSubmitted && (
                                                    <button onClick={() => handleForceInit(team)} className="text-xs text-red-500 mt-3 hover:underline bg-white px-3 py-1 rounded-full border border-red-200 shadow-sm transition-colors hover:bg-red-50">입찰 강제 취소</button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="flex space-x-4">
                                    <button
                                        onClick={() => {
                                            setConfirmDialog({
                                                message: "미제출 모둠을 미낙찰로 처리하고 결과를 강제로 공개하시겠습니까?",
                                                onConfirm: () => {
                                                    resolveRound(true);
                                                    setConfirmDialog(null);
                                                }
                                            });
                                        }}
                                        className="flex-1 bg-[#1F4E79] hover:bg-[#153654] text-white py-3 rounded-xl font-bold flex justify-center items-center transition-colors shadow-md"
                                    >
                                        <Play size={18} className="mr-2" /> 미제출 무시하고 결과 강제 공개
                                    </button>
                                </div>
                            </>
                        )}

                        {gameState.phase !== 'bidding' && (
                            <div className="text-center py-10 bg-gray-50 rounded-xl mb-6 shadow-inner border border-gray-200">
                                <p className="text-gray-600 mb-4 font-bold text-lg">학생들에게 결과 화면이 공개되었습니다.</p>
                                {gameState.round < 4 ? (
                                    <button
                                        onClick={handleNextRound}
                                        className="bg-[#ED7D31] hover:bg-[#d66b26] text-white px-10 py-4 rounded-xl font-black text-xl shadow-lg transition-transform hover:scale-105 flex items-center justify-center mx-auto"
                                    >
                                        다음 라운드 시작하기 <ArrowRight className="ml-2" />
                                    </button>
                                ) : (
                                    <div className="text-[#1F4E79] font-black text-2xl mt-4">모든 드래프트가 종료되었습니다.</div>
                                )}
                            </div>
                        )}

                        <hr className="my-8 border-gray-200" />
                        <div className="text-right">
                            <button
                                onClick={handleResetGame}
                                className="text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg font-bold inline-flex items-center border border-red-200 transition-colors"
                            >
                                <RotateCcw size={16} className="mr-2" /> 게임 전체 강제 리셋 (새 수업)
                            </button>
                        </div>
                    </div>
                </div>

                {/* 선생님 화면에서도 학생들과 동일한 결과를 볼 수 있도록 추가 */}
                {gameState.phase !== 'bidding' && (
                    <div className="opacity-90 pointer-events-none mt-8">
                        <h3 className="text-white font-bold text-xl mb-4 text-center">👇 현재 학생들에게 보여지는 결과 화면 👇</h3>
                        {renderResult()}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-[#1F4E79] font-sans selection:bg-[#ED7D31] selection:text-white relative">
            <div className="max-w-6xl mx-auto py-8">
                {view === 'home' && renderHome()}
                {view === 'bidding' && renderBidding()}
                {view === 'result' && renderResult()}
                {view === 'teacher' && renderTeacher()}
            </div>

            {/* 선생님 로그인 모달 */}
            {showTeacherLogin && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm relative">
                        <button
                            onClick={() => { setShowTeacherLogin(false); setLoginError(''); setTeacherPwInput(''); }}
                            className="absolute top-4 right-4 text-gray-400 hover:text-gray-700"
                        >
                            <X size={24} />
                        </button>
                        <h3 className="text-xl font-black text-gray-800 mb-4 flex items-center">
                            <ShieldAlert className="mr-2 text-[#ED7D31]" /> 관리자 로그인
                        </h3>
                        <form onSubmit={handleTeacherLogin}>
                            <input
                                type="password"
                                value={teacherPwInput}
                                onChange={(e) => setTeacherPwInput(e.target.value)}
                                placeholder="비밀번호 입력"
                                className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1F4E79] mb-2"
                                autoFocus
                            />
                            {loginError && <p className="text-red-500 text-sm font-bold mb-4">{loginError}</p>}
                            <button
                                type="submit"
                                className="w-full bg-[#1F4E79] text-white font-bold py-3 rounded-xl mt-4 hover:bg-[#153654] transition-colors"
                            >
                                확인
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* 공통 Confirm 모달 */}
            {confirmDialog && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
                        <h3 className="text-lg font-bold text-gray-800 mb-4 whitespace-pre-line leading-relaxed">
                            {confirmDialog.message}
                        </h3>
                        <div className="flex space-x-3 mt-6">
                            <button
                                onClick={() => setConfirmDialog(null)}
                                className="flex-1 bg-gray-200 text-gray-800 font-bold py-3 rounded-xl hover:bg-gray-300 transition-colors"
                            >
                                취소
                            </button>
                            <button
                                onClick={confirmDialog.onConfirm}
                                className="flex-1 bg-red-500 text-white font-bold py-3 rounded-xl hover:bg-red-600 transition-colors"
                            >
                                확인
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ==========================================
// Sub-components
// ==========================================

function BiddingForm({ players, budget, onSubmit, errorMsg }) {
    const [pick1, setPick1] = useState('');
    const [token1, setToken1] = useState('');
    const [pick2, setPick2] = useState('');
    const [token2, setToken2] = useState('');
    const [localError, setLocalError] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        setLocalError('');

        if (!pick1 || !pick2) {
            setLocalError('1순위와 2순위 선수를 모두 선택해주세요.');
            return;
        }
        if (pick1 === pick2) {
            setLocalError('1순위와 2순위 선수는 달라야 합니다.');
            return;
        }

        const t1 = parseInt(token1, 10);
        const t2 = parseInt(token2, 10);

        if (isNaN(t1) || t1 < 1 || t1 > budget) {
            setLocalError(`1순위 입찰 토큰은 1 이상, 남은 예산(${budget}) 이하로 입력해야 합니다.`);
            return;
        }
        if (isNaN(t2) || t2 < 1 || t2 > budget) {
            setLocalError(`2순위 입찰 토큰은 1 이상, 남은 예산(${budget}) 이하로 입력해야 합니다.`);
            return;
        }

        onSubmit(pick1, t1, pick2, t2);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {(errorMsg || localError) && (
                <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-4 rounded shadow-sm" role="alert">
                    <p className="font-bold">입력 오류</p>
                    <p>{localError || errorMsg}</p>
                </div>
            )}

            <div className="bg-white p-5 rounded-xl border border-blue-100 shadow-sm">
                <h4 className="font-bold text-[#1F4E79] mb-4 flex items-center border-b pb-2">
                    <span className="bg-[#1F4E79] text-white w-6 h-6 rounded-full inline-flex items-center justify-center mr-2 text-sm">1</span>
                    1순위 지명
                </h4>
                <div className="space-y-4">
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-1">선수 선택 <span className="text-red-500">*</span></label>
                        <select
                            value={pick1}
                            onChange={(e) => setPick1(e.target.value)}
                            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1F4E79] focus:border-transparent text-lg bg-gray-50"
                        >
                            <option value="">선택...</option>
                            {players.map(p => <option key={`1-${p}`} value={p}>{p}</option>)}
                        </select>
                    </div>
                    <div className="relative">
                        <label className="block text-gray-700 text-sm font-bold mb-1">입찰 토큰 <span className="text-red-500">*</span></label>
                        <input
                            type="number"
                            min="1"
                            max={budget}
                            value={token1}
                            onChange={(e) => setToken1(e.target.value)}
                            placeholder="예: 50"
                            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#ED7D31] focus:border-transparent text-xl font-bold font-mono"
                        />
                        <span className="absolute right-4 bottom-3 text-gray-400 font-bold">T</span>
                    </div>
                </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                <h4 className="font-bold text-gray-600 mb-4 flex items-center border-b pb-2">
                    <span className="bg-gray-400 text-white w-6 h-6 rounded-full inline-flex items-center justify-center mr-2 text-sm">2</span>
                    2순위 지명 <span className="text-xs font-normal text-gray-400 ml-2">(1순위 실패 시 발동)</span>
                </h4>
                <div className="space-y-4">
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-1">선수 선택 <span className="text-red-500">*</span></label>
                        <select
                            value={pick2}
                            onChange={(e) => setPick2(e.target.value)}
                            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1F4E79] focus:border-transparent text-lg bg-gray-50"
                        >
                            <option value="">선택...</option>
                            {players.map(p => <option key={`2-${p}`} value={p} disabled={p === pick1}>{p}</option>)}
                        </select>
                    </div>
                    <div className="relative">
                        <label className="block text-gray-700 text-sm font-bold mb-1">입찰 토큰 <span className="text-red-500">*</span></label>
                        <input
                            type="number"
                            min="1"
                            max={budget}
                            value={token2}
                            onChange={(e) => setToken2(e.target.value)}
                            placeholder="예: 20"
                            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#ED7D31] focus:border-transparent text-xl font-bold font-mono"
                        />
                        <span className="absolute right-4 bottom-3 text-gray-400 font-bold">T</span>
                    </div>
                </div>
            </div>

            <button
                type="submit"
                className="w-full bg-[#ED7D31] hover:bg-[#d66b26] text-white font-black text-xl py-4 rounded-xl shadow-lg transition-transform transform active:scale-95 mt-2"
            >
                최종 입찰서 제출
            </button>

            <p className="text-center text-sm text-gray-500 font-medium">제출 후에는 수정할 수 없습니다.</p>
        </form>
    );
}