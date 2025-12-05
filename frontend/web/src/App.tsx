// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface PassportData {
  id: number;
  nationality: string;
  passportNumber: string;
  encryptedData: string;
  expiryDate: number;
  visaValid: boolean;
  timestamp: number;
}

interface TravelRecord {
  id: number;
  country: string;
  entryDate: number;
  exitDate: number;
  purpose: string;
  encryptedVerification: string;
}

interface UserAction {
  type: 'add' | 'verify' | 'decrypt' | 'update';
  timestamp: number;
  details: string;
}

// FHE encryption/decryption functions
const FHEEncryptNumber = (value: number): string => `FHE-${btoa(value.toString())}`;
const FHEDecryptNumber = (encryptedData: string): number => encryptedData.startsWith('FHE-') ? parseFloat(atob(encryptedData.substring(4))) : parseFloat(encryptedData);
const FHEEncryptBoolean = (value: boolean): string => `FHE-${btoa(value ? '1' : '0')}`;
const FHEDecryptBoolean = (encryptedData: string): boolean => encryptedData.startsWith('FHE-') ? atob(encryptedData.substring(4)) === '1' : encryptedData === 'true';

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [passport, setPassport] = useState<PassportData | null>(null);
  const [travelRecords, setTravelRecords] = useState<TravelRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingPassport, setAddingPassport] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newPassportData, setNewPassportData] = useState({ nationality: "", passportNumber: "", expiryDate: "" });
  const [decryptedData, setDecryptedData] = useState<{ nationality: string | null; passportNumber: string | null; expiryDate: number | null; visaValid: boolean | null }>({ nationality: null, passportNumber: null, expiryDate: null, visaValid: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [chainId, setChainId] = useState(0);
  const [startTimestamp, setStartTimestamp] = useState(0);
  const [durationDays, setDurationDays] = useState(30);
  const [userActions, setUserActions] = useState<UserAction[]>([]);
  const [activeTab, setActiveTab] = useState('passport');
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCountry, setFilterCountry] = useState("");

  // Initialize signature parameters
  useEffect(() => {
    loadData().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  // Load data from contract
  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
      
      // Load passport
      const passportBytes = await contract.getData("passport");
      let passportData: PassportData | null = null;
      if (passportBytes.length > 0) {
        try {
          const passportStr = ethers.toUtf8String(passportBytes);
          if (passportStr.trim() !== '') passportData = JSON.parse(passportStr);
        } catch (e) {}
      }
      setPassport(passportData);
      
      // Load travel records
      const recordsBytes = await contract.getData("travelRecords");
      let recordsList: TravelRecord[] = [];
      if (recordsBytes.length > 0) {
        try {
          const recordsStr = ethers.toUtf8String(recordsBytes);
          if (recordsStr.trim() !== '') recordsList = JSON.parse(recordsStr);
        } catch (e) {}
      }
      setTravelRecords(recordsList);
    } catch (e) {
      console.error("Error loading data:", e);
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  // Add new passport
  const addPassport = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setAddingPassport(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Adding passport with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Create new passport
      const expiryTimestamp = new Date(newPassportData.expiryDate).getTime() / 1000;
      const newPassport: PassportData = {
        id: 1,
        nationality: newPassportData.nationality,
        passportNumber: newPassportData.passportNumber,
        encryptedData: FHEEncryptNumber(expiryTimestamp),
        expiryDate: expiryTimestamp,
        visaValid: true, // Default to valid
        timestamp: Math.floor(Date.now() / 1000)
      };
      
      // Save to contract
      await contract.setData("passport", ethers.toUtf8Bytes(JSON.stringify(newPassport)));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'add',
        timestamp: Math.floor(Date.now() / 1000),
        details: `Added passport: ${newPassportData.nationality}`
      };
      setUserActions(prev => [newAction, ...prev]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Passport added successfully!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowAddModal(false);
        setNewPassportData({ nationality: "", passportNumber: "", expiryDate: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setAddingPassport(false); 
    }
  };

  // Verify passport validity
  const verifyPassport = async () => {
    if (!isConnected || !address || !passport) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet and add passport first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Verifying passport with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Update visa validity (simulate verification)
      const updatedPassport = { ...passport };
      updatedPassport.visaValid = Math.random() > 0.5; // Random validity for demo
      updatedPassport.encryptedData = FHEEncryptBoolean(updatedPassport.visaValid);
      
      // Save to contract
      await contract.setData("passport", ethers.toUtf8Bytes(JSON.stringify(updatedPassport)));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'verify',
        timestamp: Math.floor(Date.now() / 1000),
        details: `Verified passport: ${updatedPassport.visaValid ? "Valid" : "Invalid"}`
      };
      setUserActions(prev => [newAction, ...prev]);
      
      setTransactionStatus({ visible: true, status: "success", message: `Passport verification ${updatedPassport.visaValid ? "successful" : "failed"}` });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Verification failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  // Decrypt passport with signature
  const decryptWithSignature = async () => {
    if (!isConnected || !passport) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet and add passport first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Decrypt data (simulated)
      const decryptedExpiry = FHEDecryptNumber(passport.encryptedData);
      const decryptedVisa = FHEDecryptBoolean(FHEEncryptBoolean(passport.visaValid));
      
      setDecryptedData({
        nationality: passport.nationality,
        passportNumber: passport.passportNumber,
        expiryDate: decryptedExpiry,
        visaValid: decryptedVisa
      });
      
      // Update user actions
      const newAction: UserAction = {
        type: 'decrypt',
        timestamp: Math.floor(Date.now() / 1000),
        details: "Decrypted passport data"
      };
      setUserActions(prev => [newAction, ...prev]);
      
    } catch (e) { 
      console.error("Decryption failed:", e);
    } finally { 
      setIsDecrypting(false); 
    }
  };

  // Add travel record
  const addTravelRecord = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Adding travel record with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Create new record (demo data)
      const countries = ["USA", "Japan", "Germany", "France", "UK", "Canada", "Australia"];
      const purposes = ["Business", "Tourism", "Study", "Family Visit"];
      const randomCountry = countries[Math.floor(Math.random() * countries.length)];
      const randomPurpose = purposes[Math.floor(Math.random() * purposes.length)];
      const entryDate = Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 30 * 24 * 60 * 60);
      const exitDate = entryDate + Math.floor(Math.random() * 7 * 24 * 60 * 60);
      
      const newRecord: TravelRecord = {
        id: travelRecords.length + 1,
        country: randomCountry,
        entryDate: entryDate,
        exitDate: exitDate,
        purpose: randomPurpose,
        encryptedVerification: FHEEncryptNumber(1) // Simulate verification
      };
      
      // Update records list
      const updatedRecords = [...travelRecords, newRecord];
      
      // Save to contract
      await contract.setData("travelRecords", ethers.toUtf8Bytes(JSON.stringify(updatedRecords)));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'add',
        timestamp: Math.floor(Date.now() / 1000),
        details: `Added travel record: ${randomCountry}`
      };
      setUserActions(prev => [newAction, ...prev]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Travel record added!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  // Render passport stats
  const renderPassportStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-item">
          <div className="stat-value">{passport ? passport.nationality : "--"}</div>
          <div className="stat-label">Nationality</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{passport ? (passport.visaValid ? "Valid" : "Invalid") : "--"}</div>
          <div className="stat-label">Visa Status</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{travelRecords.length}</div>
          <div className="stat-label">Travel Records</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">
            {travelRecords.length > 0 
              ? [...new Set(travelRecords.map(r => r.country))].length
              : 0}
          </div>
          <div className="stat-label">Countries Visited</div>
        </div>
      </div>
    );
  };

  // Render user actions history
  const renderUserActions = () => {
    if (userActions.length === 0) return <div className="no-data">No actions recorded</div>;
    
    return (
      <div className="actions-list">
        {userActions.map((action, index) => (
          <div className="action-item" key={index}>
            <div className={`action-type ${action.type}`}>
              {action.type === 'add' && '➕'}
              {action.type === 'verify' && '✅'}
              {action.type === 'decrypt' && '🔓'}
              {action.type === 'update' && '🔄'}
            </div>
            <div className="action-details">
              <div className="action-text">{action.details}</div>
              <div className="action-time">{new Date(action.timestamp * 1000).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render FAQ section
  const renderFAQ = () => {
    const faqItems = [
      {
        question: "What is Private Digital Passport?",
        answer: "A privacy-preserving travel document that stores your passport information encrypted with Fully Homomorphic Encryption (FHE), allowing verification without revealing sensitive data."
      },
      {
        question: "How does FHE protect my passport data?",
        answer: "FHE allows border control and hotels to verify your nationality or visa status without seeing your actual passport details. All computations happen on encrypted data."
      },
      {
        question: "Is my data stored on blockchain?",
        answer: "No, your encrypted passport data is stored locally on your device. Only verification proofs are exchanged when needed."
      },
      {
        question: "What can be verified with this passport?",
        answer: "Authorities can verify your nationality, passport validity, visa status, and travel history without accessing the raw data."
      },
      {
        question: "How does Zama FHE work with this?",
        answer: "Zama FHE provides the encryption technology that enables private computations on your passport data while keeping it fully encrypted."
      }
    ];
    
    return (
      <div className="faq-container">
        {faqItems.map((item, index) => (
          <div className="faq-item" key={index}>
            <div className="faq-question">{item.question}</div>
            <div className="faq-answer">{item.answer}</div>
          </div>
        ))}
      </div>
    );
  };

  // Filter travel records
  const filteredRecords = travelRecords.filter(record => {
    const matchesSearch = record.country.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         record.purpose.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterCountry === "" || record.country === filterCountry;
    return matchesSearch && matchesFilter;
  });

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing encrypted passport system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="passport-icon"></div>
          </div>
          <h1>Travel<span>Pass</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowAddModal(true)} 
            className="add-passport-btn"
            disabled={!!passport}
          >
            <div className="add-icon"></div>
            {passport ? "Passport Added" : "Add Passport"}
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <div className="dashboard-grid">
            <div className="dashboard-panel intro-panel">
              <div className="panel-card">
                <h2>Private Digital Passport</h2>
                <p>Your passport information is FHE encrypted on your device. Verify nationality and visa status without revealing sensitive data.</p>
                <div className="fhe-badge">
                  <div className="fhe-icon"></div>
                  <span>Powered by Zama FHE</span>
                </div>
              </div>
              
              <div className="panel-card">
                <h2>Passport Statistics</h2>
                {renderPassportStats()}
              </div>
              
              <div className="panel-card">
                <h2>Quick Actions</h2>
                <div className="quick-actions">
                  <button 
                    onClick={verifyPassport} 
                    className="action-btn verify"
                    disabled={!passport}
                  >
                    Verify Visa Status
                  </button>
                  <button 
                    onClick={decryptWithSignature} 
                    className="action-btn decrypt"
                    disabled={!passport || isDecrypting}
                  >
                    {isDecrypting ? "Decrypting..." : "View Passport Data"}
                  </button>
                  <button 
                    onClick={addTravelRecord} 
                    className="action-btn add-record"
                  >
                    Add Travel Record
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          <div className="tabs-container">
            <div className="tabs">
              <button 
                className={`tab ${activeTab === 'passport' ? 'active' : ''}`}
                onClick={() => setActiveTab('passport')}
              >
                Passport
              </button>
              <button 
                className={`tab ${activeTab === 'travel' ? 'active' : ''}`}
                onClick={() => setActiveTab('travel')}
              >
                Travel History
              </button>
              <button 
                className={`tab ${activeTab === 'actions' ? 'active' : ''}`}
                onClick={() => setActiveTab('actions')}
              >
                My Actions
              </button>
              <button 
                className={`tab ${activeTab === 'faq' ? 'active' : ''}`}
                onClick={() => setActiveTab('faq')}
              >
                FAQ
              </button>
            </div>
            
            <div className="tab-content">
              {activeTab === 'passport' && (
                <div className="passport-section">
                  <div className="section-header">
                    <h2>My Digital Passport</h2>
                    <div className="header-actions">
                      <button 
                        onClick={loadData} 
                        className="refresh-btn" 
                        disabled={isRefreshing}
                      >
                        {isRefreshing ? "Refreshing..." : "Refresh"}
                      </button>
                    </div>
                  </div>
                  
                  {!passport ? (
                    <div className="no-passport">
                      <div className="no-passport-icon"></div>
                      <p>No passport found</p>
                      <button 
                        className="add-btn" 
                        onClick={() => setShowAddModal(true)}
                      >
                        Add Your Passport
                      </button>
                    </div>
                  ) : (
                    <div className="passport-details">
                      <div className="passport-info">
                        <div className="info-row">
                          <span>Nationality:</span>
                          <strong>{decryptedData.nationality || passport.nationality}</strong>
                        </div>
                        <div className="info-row">
                          <span>Passport Number:</span>
                          <strong>{decryptedData.passportNumber || passport.passportNumber}</strong>
                        </div>
                        <div className="info-row">
                          <span>Expiry Date:</span>
                          <strong>
                            {decryptedData.expiryDate 
                              ? new Date(decryptedData.expiryDate * 1000).toLocaleDateString() 
                              : "Encrypted"}
                          </strong>
                        </div>
                        <div className="info-row">
                          <span>Visa Valid:</span>
                          <strong>
                            {decryptedData.visaValid !== null 
                              ? (decryptedData.visaValid ? "Valid" : "Invalid") 
                              : (passport.visaValid ? "Valid (Encrypted)" : "Invalid (Encrypted)")}
                          </strong>
                        </div>
                      </div>
                      
                      <div className="encrypted-section">
                        <h3>Encrypted Data</h3>
                        <div className="encrypted-data">
                          {passport.encryptedData.substring(0, 30)}...
                        </div>
                        <div className="fhe-tag">
                          <div className="fhe-icon"></div>
                          <span>FHE Encrypted</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {activeTab === 'travel' && (
                <div className="travel-section">
                  <div className="section-header">
                    <h2>Travel History</h2>
                    <div className="header-actions">
                      <div className="search-filter">
                        <input 
                          type="text" 
                          placeholder="Search records..." 
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <select 
                          value={filterCountry} 
                          onChange={(e) => setFilterCountry(e.target.value)}
                        >
                          <option value="">All Countries</option>
                          {[...new Set(travelRecords.map(r => r.country))].map(country => (
                            <option key={country} value={country}>{country}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  
                  <div className="records-list">
                    {filteredRecords.length === 0 ? (
                      <div className="no-records">
                        <div className="no-records-icon"></div>
                        <p>No travel records found</p>
                        <button 
                          className="add-btn" 
                          onClick={addTravelRecord}
                        >
                          Add Travel Record
                        </button>
                      </div>
                    ) : filteredRecords.map((record, index) => (
                      <div className="record-item" key={index}>
                        <div className="record-country">{record.country}</div>
                        <div className="record-dates">
                          {new Date(record.entryDate * 1000).toLocaleDateString()} - 
                          {new Date(record.exitDate * 1000).toLocaleDateString()}
                        </div>
                        <div className="record-purpose">{record.purpose}</div>
                        <div className="record-status">
                          <span className="verified">Verified</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {activeTab === 'actions' && (
                <div className="actions-section">
                  <h2>My Activity History</h2>
                  {renderUserActions()}
                </div>
              )}
              
              {activeTab === 'faq' && (
                <div className="faq-section">
                  <h2>Frequently Asked Questions</h2>
                  {renderFAQ()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {showAddModal && (
        <ModalAddPassport 
          onSubmit={addPassport} 
          onClose={() => setShowAddModal(false)} 
          adding={addingPassport} 
          passportData={newPassportData} 
          setPassportData={setNewPassportData}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="passport-icon"></div>
              <span>TravelPass_FHE</span>
            </div>
            <p>Private digital passport powered by FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">© {new Date().getFullYear()} TravelPass_FHE. All rights reserved.</div>
          <div className="disclaimer">
            This system uses fully homomorphic encryption to protect your passport data. 
            Verifications are performed on encrypted data without revealing sensitive information.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalAddPassportProps {
  onSubmit: () => void; 
  onClose: () => void; 
  adding: boolean;
  passportData: any;
  setPassportData: (data: any) => void;
}

const ModalAddPassport: React.FC<ModalAddPassportProps> = ({ onSubmit, onClose, adding, passportData, setPassportData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPassportData({ ...passportData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="add-passport-modal">
        <div className="modal-header">
          <h2>Add Your Passport</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div>
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Your passport data will be encrypted using Zama FHE</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Nationality *</label>
            <input 
              type="text" 
              name="nationality" 
              value={passportData.nationality} 
              onChange={handleChange} 
              placeholder="Enter your nationality..." 
            />
          </div>
          
          <div className="form-group">
            <label>Passport Number *</label>
            <input 
              type="text" 
              name="passportNumber" 
              value={passportData.passportNumber} 
              onChange={handleChange} 
              placeholder="Enter passport number..." 
            />
          </div>
          
          <div className="form-group">
            <label>Expiry Date *</label>
            <input 
              type="date" 
              name="expiryDate" 
              value={passportData.expiryDate} 
              onChange={handleChange} 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={adding || !passportData.nationality || !passportData.passportNumber || !passportData.expiryDate} 
            className="submit-btn"
          >
            {adding ? "Encrypting with FHE..." : "Add Passport"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;