import axios from 'axios'
import { supabase } from '@/lib/superbase/client';
import type { User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { BACKEND_URL } from '@/lib/config';

export default function Dashboard() {
    const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    async function getInfo() {
        
      const { data, error } = await supabase.auth.getUser();

      if (error) {
        console.error(error.message);
        return;
      }

      setUser(data.user);
    }

    getInfo();
  }, []);

  useEffect(() => {
    async function  getExistingConversation() {
      if(user){
        const {data : {session}} = await supabase.auth.getSession();
        const jwt = session?.access_token;
        const response = await axios.get(`${BACKEND_URL}/convesations`, {
          headers:{
            Authorization :jwt
          }
        })
        console.log(response.data);

      } 
    }
    getExistingConversation();


  },[user])

  return <div>

    {!user && <button onClick={() => {
        navigate("/auth")

    }}>Sign in </button>}
    

    {user && <div>
        {user?.email}
        <button onClick={() => {
            supabase.auth.signOut();
            setUser(null);
            }}>Logout</button>
        
        </div>}
    
    </div>;
}